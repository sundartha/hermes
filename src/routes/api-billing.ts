import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { flushMeters } from "../billing/meter.js";
import { bindCardFromSession, startCheckoutWithStaleCustomerHeal } from "../billing/card-setup.ts";
import { requirePaymentEnabled, requirePublicUrl } from "../billing/payment-gate.ts";
import { SWEEP_TRIGGER, PROVIDER_COST_RECORD_WINDOW_MS } from "../billing/cost-truing.ts";
import { kostenBuchBericht } from "../billing/kosten-deckung.ts";
import { providerMicroCentsToBucketCents, tariffDriftReportFromConfig } from "../billing/cost-calibration.ts";
import { countActiveNumbers } from "../store/views.js";
import { MICRO_CENTS_PER_CENT } from "../begriffe/abrechnung.js";
import { speicherBereiche } from "../store.js";
import { CHECKOUT_RETURN } from "../portal-paths.js";
import { operatorRoutes } from "../wiring/operator-routes.js";
import { createRateLimiter } from "../middleware.js";
import { internalOnly } from "../wiring/internal-only.js";
import { pruefeAbfrage } from "../utils/eingabe-pruefen.js";
import { HTTP_FORBIDDEN, HTTP_SERVER_ERROR, antworteFehler } from "../utils/http.ts";

const CARD_ON_FILE_STATUS = "card_on_file";
const KARTENABLAUF_ABRUFE_PRO_MINUTE = 10;

type KartenBindung = Parameters<typeof bindCardFromSession>[0];
type KostenBerichtArgs = Parameters<typeof kostenBuchBericht>[0];
type Anrufe = Parameters<typeof tariffDriftReportFromConfig>[0];
type Abrechnung = KostenBerichtArgs["billing"] &
  Parameters<typeof tariffDriftReportFromConfig>[1] & {
    paymentEnabled: boolean;
    platformFixedCostUsdCentsPerMonth: number;
    numberMonthlyCostCents: number;
    flushEpochIso: string | null | undefined;
    stripeCustomerRetryDelayMs: number;
  };
type Zustand = NonNullable<KostenBerichtArgs["state"]> & { calls: Anrufe };
type Speicher = KartenBindung["store"] & { load: () => Zustand; save: () => void };
type Abrechner = KartenBindung["billing"] & {
  createSetupCheckoutSession: (args: {
    tenantRef: string;
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }) => Promise<{ url: string | null }>;
};
interface Fluss {
  sent: number;
  failed: number;
  skipped: number;
  skipReason?: string | null | undefined;
}

type Weiter = (fehler?: unknown) => void;

interface Konfiguration {
  billing: Abrechnung;
  server: { publicUrl: string | null | undefined };
}

interface Bereiche {
  tts: { platformTtsUsageView: (nowIso: string) => unknown };
}

interface Kostenabgleich {
  runCostTruingSweep: (auswahl: { trigger: string }) => Promise<{ skipped: boolean; coveragePercent?: number | undefined }>;
}

const aktiveNummernVon: (state: Zustand) => number = countActiveNumbers;
const bereicheVon: (store: Speicher) => Bereiche = speicherBereiche;
const meldeVerbrauch: (
  state: Zustand,
  args: { billing: Abrechner; flushEpochIso: string | null | undefined },
) => Promise<Fluss> = flushMeters;
const pruefeRueckkehr: (
  res: Response,
  regel: { schema: typeof RUECKKEHR_ABFRAGE; meldung: string },
  werte: unknown,
) => { session_id: string } | undefined = pruefeAbfrage;
interface Abhaengigkeiten {
  config: Konfiguration;
  store: Speicher;
  audit: (aktion: string, req: Request, detail: string) => unknown;
  billing: Abrechner;
  tenant: { requireTenant: (req: Request, res: Response) => string | null | undefined };
  costTruing: Kostenabgleich;
  operatorAuth: { webAuthMw: unknown; adminMw: unknown } | null | undefined;
}

const RUECKKEHR_ABFRAGE = z.object({ session_id: z.string().min(1) });

async function zeigePlattformkosten({
  config,
  store,
  bereiche,
  res,
}: {
  config: Konfiguration;
  store: Speicher;
  bereiche: Bereiche;
  res: Response;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const activeNumbers = aktiveNummernVon(store.load());
  const elevenLabsUsdCents = config.billing.platformFixedCostUsdCentsPerMonth;
  const elevenLabsCents =
    providerMicroCentsToBucketCents(elevenLabsUsdCents * MICRO_CENTS_PER_CENT, config.billing.providerToBucketRateMicro);
  if (elevenLabsCents === null) {
    antworteFehler(
      res,
      HTTP_SERVER_ERROR,
      "ElevenLabs-Fixkosten nicht berechenbar: Produkt aus PLATFORM_FIXED_COST_CENTS_PER_MONTH und PROVIDER_TO_BUCKET_RATE_MICRO ueberschreitet den sicheren Ganzzahlbereich",
    );
    return;
  }
  const didRentCents = config.billing.numberMonthlyCostCents * activeNumbers;
  const fixedCostCentsPerMonth = elevenLabsCents + didRentCents;
  const ttsQuota = await bereiche.tts.platformTtsUsageView(nowIso);
  res.json({
    currency: "EUR",
    listPriceNotBilled: true,
    elevenLabsUsdCents,
    elevenLabsCents,
    numberMonthlyCostCents: config.billing.numberMonthlyCostCents,
    didRentCents,
    activeNumbers,
    fixedCostCentsPerMonth,
    ttsQuota,
  });
}

export function makeBillingRoutes({
  config,
  store,
  audit,
  billing,
  tenant: { requireTenant },
  costTruing,
  operatorAuth,
}: Abhaengigkeiten): Router {
  const router = Router();
  const bereiche = bereicheVon(store);
  const operator = operatorRoutes({ router, operatorAuth });
  const sitzungBegrenzer = createRateLimiter(KARTENABLAUF_ABRUFE_PRO_MINUTE);
  const rueckkehrBegrenzer = createRateLimiter(KARTENABLAUF_ABRUFE_PRO_MINUTE);

  operator.post("/api/billing/flush-meters", async (req: Request, res: Response) => {
    if (!requirePaymentEnabled(res, config, "metering disabled (PAYMENT_ENABLED)")) return;
    const result = await meldeVerbrauch(store.load(), {
      billing,
      flushEpochIso: config.billing.flushEpochIso,
    });
    store.save();
    audit(
      "meter_flush",
      req,
      `sent=${String(result.sent)} failed=${String(result.failed)} skipped=${String(result.skipped)} grund=${result.skipReason ?? "-"}`,
    );
    res.json(result);
  });

  const legeKartenSitzungAn = async (req: Request, res: Response): Promise<void> => {
    if (!requirePaymentEnabled(res, config)) return;
    if (!requirePublicUrl(res, config)) return;
    const tenant = requireTenant(req, res);
    if (!tenant) return;

    const successUrl = `${String(config.server.publicUrl)}/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${String(config.server.publicUrl)}${CHECKOUT_RETURN.CARD_CANCELED}`;
    const { session, healed } = await startCheckoutWithStaleCustomerHeal(
      { store, billing, tenant, retryDelayMs: config.billing.stripeCustomerRetryDelayMs },
      (customerId) =>
        billing.createSetupCheckoutSession({ tenantRef: tenant, customerId, successUrl, cancelUrl }),
    );
    if (healed) audit("stripe_customer_self_heal", req, `tenant=${tenant}`);
    audit("billing_setup_checkout", req, `tenant=${tenant}`);
    res.json({ url: session.url });
  };

  router.post("/api/billing/setup-checkout", internalOnly, sitzungBegrenzer, (req: Request, res: Response, next: Weiter) => {
    legeKartenSitzungAn(req, res).catch(next);
  });

  operator.post("/api/billing/cost-truing/sweep", async (req: Request, res: Response) => {
    const result = await costTruing.runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
    audit("cost_truing_sweep", req, `skipped=${String(result.skipped)} deckung=${String(result.coveragePercent ?? "-")}%`);
    res.json(result);
  });

  operator.get("/api/billing/cost-drift", (req: Request, res: Response) => {
    res.json({ prefixes: tariffDriftReportFromConfig(store.load().calls, config.billing) });
  });

  operator.get("/api/billing/platform-costs", (req: Request, res: Response, next: Weiter) => {
    zeigePlattformkosten({ config, store, bereiche, res }).catch(next);
  });

  operator.get("/api/billing/kosten-deckung", (req: Request, res: Response) => {
    res.json(kostenBuchBericht({
      state: store.load(), billing: config.billing, nowMs: Date.now(),
      deckungFensterMs: PROVIDER_COST_RECORD_WINDOW_MS,
    }));
  });

  const speichereKarteAusSitzung = async (req: Request, res: Response): Promise<void> => {
    if (!requirePaymentEnabled(res, config)) return;
    const tenant = requireTenant(req, res);
    if (!tenant) return;
    const abfrage = pruefeRueckkehr(res, { schema: RUECKKEHR_ABFRAGE, meldung: "session_id ist Pflicht" }, req.query);
    if (abfrage === undefined) return;
    const sessionId = abfrage.session_id;

    const { ok } = await bindCardFromSession({ store, billing, tenant, sessionId });
    if (!ok) {
      audit("billing_card_mismatch", req, `tenant=${tenant}`);
      antworteFehler(res, HTTP_FORBIDDEN, "Customer-Mismatch");
      return;
    }
    audit("billing_card_saved", req, `tenant=${tenant}`);
    res.json({ status: CARD_ON_FILE_STATUS });
  };

  router.get("/api/billing/checkout-return", internalOnly, rueckkehrBegrenzer, (req: Request, res: Response, next: Weiter) => {
    speichereKarteAusSitzung(req, res).catch(next);
  });

  return router;
}
