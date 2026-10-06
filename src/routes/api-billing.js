import { Router } from "express";
import { flushMeters } from "../billing/meter.js";
import { bindCardFromSession, startCheckoutWithStaleCustomerHeal } from "../billing/card-setup.js";
import { requirePaymentEnabled, requirePublicUrl } from "../billing/payment-gate.js";
import { SWEEP_TRIGGER, PROVIDER_COST_RECORD_WINDOW_MS } from "../billing/cost-truing.js";
import { kostenBuchBericht } from "../billing/kosten-deckung.js";
import { providerMicroCentsToBucketCents, tariffDriftReportFromConfig } from "../billing/cost-calibration.js";
import { countActiveNumbers } from "../store/views.js";
import { MICRO_CENTS_PER_CENT } from "../store/defaults.js";
import { CHECKOUT_RETURN } from "../portal-paths.js";
import { operatorRoutes } from "../wiring/operator-routes.js";
import { internalOnly } from "../wiring/internal-only.js";

const CARD_ON_FILE_STATUS = "card_on_file";

const HTTP_SERVER_ERROR = 500;

export function makeBillingRoutes({
  config,
  store,
  audit,
  billing,
  tenant: { requireTenant },
  costTruing,
  operatorAuth,
}) {
  const router = Router();
  const operator = operatorRoutes({ router, operatorAuth });

  operator.post("/api/billing/flush-meters", async (req, res) => {
    if (!requirePaymentEnabled(res, config, "metering disabled (PAYMENT_ENABLED)")) return;
    const result = await flushMeters(store.load(), {
      billing,
      flushEpochIso: config.billing.flushEpochIso,
    });
    store.save();
    audit(
      "meter_flush",
      req,
      `sent=${result.sent} failed=${result.failed} skipped=${result.skipped} grund=${result.skipReason ?? "-"}`,
    );
    res.json(result);
  });

  router.post("/api/billing/setup-checkout", internalOnly, async (req, res) => {
    if (!requirePaymentEnabled(res, config)) return;
    if (!requirePublicUrl(res, config)) return;
    const tenant = requireTenant(req, res);
    if (!tenant) return;

    const successUrl = `${config.server.publicUrl}/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.server.publicUrl}${CHECKOUT_RETURN.CARD_CANCELED}`;
    const { session, healed } = await startCheckoutWithStaleCustomerHeal(
      { store, billing, tenant, retryDelayMs: config.billing.stripeCustomerRetryDelayMs },
      (customerId) =>
        billing.createSetupCheckoutSession({ tenantRef: tenant, customerId, successUrl, cancelUrl }),
    );
    if (healed) audit("stripe_customer_self_heal", req, `tenant=${tenant}`);
    audit("billing_setup_checkout", req, `tenant=${tenant}`);
    res.json({ url: session.url });
  });

  operator.post("/api/billing/cost-truing/sweep", async (req, res) => {
    const result = await costTruing.runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
    audit("cost_truing_sweep", req, `skipped=${result.skipped} deckung=${result.coveragePercent ?? "-"}%`);
    res.json(result);
  });

  operator.get("/api/billing/cost-drift", (req, res) => {
    res.json({ prefixes: tariffDriftReportFromConfig(store.load().calls, config.billing) });
  });

  operator.get("/api/billing/platform-costs", (req, res) => {
    const nowIso = new Date().toISOString();
    const activeNumbers = countActiveNumbers(store.load());
    const elevenLabsUsdCents = config.billing.platformFixedCostUsdCentsPerMonth;
    const elevenLabsCents =
      providerMicroCentsToBucketCents(elevenLabsUsdCents * MICRO_CENTS_PER_CENT, config.billing.providerToBucketRateMicro);
    if (elevenLabsCents === null) {
      return res.status(HTTP_SERVER_ERROR).json({
        error:
          "ElevenLabs-Fixkosten nicht berechenbar: Produkt aus PLATFORM_FIXED_COST_CENTS_PER_MONTH und PROVIDER_TO_BUCKET_RATE_MICRO ueberschreitet den sicheren Ganzzahlbereich",
      });
    }
    const didRentCents = config.billing.numberMonthlyCostCents * activeNumbers;
    const fixedCostCentsPerMonth = elevenLabsCents + didRentCents;
    res.json({
      currency: "EUR",
      listPriceNotBilled: true,
      elevenLabsUsdCents,
      elevenLabsCents,
      didRentCents,
      activeNumbers,
      fixedCostCentsPerMonth,
      ttsQuota: store.platformTtsUsageView(nowIso),
    });
  });

  operator.get("/api/billing/kosten-deckung", (req, res) => {
    res.json(kostenBuchBericht({
      state: store.load(), billing: config.billing, nowMs: Date.now(),
      deckungFensterMs: PROVIDER_COST_RECORD_WINDOW_MS,
    }));
  });

  router.get("/api/billing/checkout-return", internalOnly, async (req, res) => {
    if (!requirePaymentEnabled(res, config)) return;
    const tenant = requireTenant(req, res);
    if (!tenant) return;
    const sessionId = req.query.session_id;
    if (!sessionId || typeof sessionId !== "string")
      return res.status(400).json({ error: "session_id ist Pflicht" });

    const { ok } = await bindCardFromSession({ store, billing, tenant, sessionId });
    if (!ok) {
      audit("billing_card_mismatch", req, `tenant=${tenant}`);
      return res.status(403).json({ error: "Customer-Mismatch" });
    }
    audit("billing_card_saved", req, `tenant=${tenant}`);
    res.json({ status: CARD_ON_FILE_STATUS });
  });

  return router;
}
