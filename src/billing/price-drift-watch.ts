import { PLAN_CATALOG } from "../plans.ts";
import { priceIdForPlan } from "./subscribe.ts";
import { meldeBetreiberNotiz, meldeVollBefund } from "../telephony/outage-report.js";
import * as ops from "../store/state-ops.js";

interface Alert {
  code: string;
  closedAt: string | null;
  lastSeenAt?: string | null;
}

interface Store {
  load: () => { outageAlerts: Alert[] };
  save: () => unknown;
  withStoreLock: <Result>(fn: () => Result) => Promise<Result>;
}

type Audit = (event: string, actor: null, detail: string) => unknown;

interface Config {
  billing: {
    paymentEnabled: boolean;
    priceDriftMinIntervalMs: number;
    priceDriftUnknownEscalateAfter: number;
    stripeStarterPriceId: string;
    stripeBusinessPriceId: string;
  };
}

interface Plan {
  slug: string;
  amountCents: number;
  currency: string;
}

interface Messung {
  unitAmountCents?: unknown;
  currency?: unknown;
}

type LesePreis = (priceId: string) => Promise<Messung | null | undefined>;

interface Befund {
  slug: string;
  detail: string;
}

interface Urteil {
  urteil: string;
  detail: string;
}

interface Sweep {
  store: Store;
  config: Config;
  audit: Audit;
  messaging: unknown;
  mailer: unknown;
}

interface NotizArgs {
  store: Store;
  audit: Audit;
  bucket: string;
  aktion: string;
  zeile: string;
  nowMs: number;
}

type BefundArgs = NotizArgs & Omit<Sweep, "audit" | "store">;

const meldeBetreiberNotizTypisiert: (args: NotizArgs) => Promise<void> = meldeBetreiberNotiz;
const meldeVollBefundTypisiert: (args: BefundArgs) => Promise<void> = meldeVollBefund;
const claimeAlarm: (state: unknown, args: { code: string; nowMs: number }) => unknown = ops.claimOutageAlert;
const oeffneAlarm: (state: unknown, code: string) => Alert | null | undefined = ops.openOutageAlert;
const schliesseAlarm: (state: unknown, args: { code: string; nowMs: number }) => unknown = ops.closeOutageAlert;

const LOG_PREFIX = "[price-drift]";
const BEFUND_PREFIX = "price-drift:";
const LAUF_MARKER = "price-drift:lauf";
const UNBEKANNT_PREFIX = "price-drift:unbekannt:";
const BEFUND_EVENT = "price_drift";
const BEHOBEN_EVENT = "price_drift_recovered";
const UNBEKANNT_EVENT = "price_drift_unknown";
const UNBEKANNT_ESKALIERT_EVENT = "price_drift_unknown_escalated";
const ERSTER_SLOT = 1;

export const priceDriftBucket = (slug: string): string => `${BEFUND_PREFIX}${slug}`;

const unbekanntSlot = (nummer: number): string => `${UNBEKANNT_PREFIX}${String(nummer)}`;
const istUnbekanntSlot = (code: string): boolean => code.startsWith(UNBEKANNT_PREFIX);
const istPreisBefund = (code: string): boolean =>
  code.startsWith(BEFUND_PREFIX) && code !== LAUF_MARKER && !istUnbekanntSlot(code);

export const PREIS_URTEIL = Object.freeze({ OK: "ok", ABWEICHUNG: "abweichung", UNBEKANNT: "unbekannt" });

const currencyGleich = (links: string, rechts: string): boolean => links.toLowerCase() === rechts.toLowerCase();

const messungsDetail = (plan: Plan, unitAmountCents: unknown, currency: string): string =>
  `slug=${plan.slug} katalog=${String(plan.amountCents)}${plan.currency} ` +
  `anbieter=${String(unitAmountCents)}${currency}`;

export function beurteilePreis(plan: Plan, messung: Messung | null | undefined): Urteil {
  if (!messung || !Number.isInteger(messung.unitAmountCents) || typeof messung.currency !== "string")
    return { urteil: PREIS_URTEIL.UNBEKANNT, detail: `slug=${plan.slug} anbieter=unlesbar` };
  const detail = messungsDetail(plan, messung.unitAmountCents, messung.currency);
  if (messung.unitAmountCents === plan.amountCents && currencyGleich(messung.currency, plan.currency))
    return { urteil: PREIS_URTEIL.OK, detail };
  return { urteil: PREIS_URTEIL.ABWEICHUNG, detail };
}

async function beanspruchen({
  store,
  nowMs,
  minIntervalMs,
}: {
  store: Store;
  nowMs: number;
  minIntervalMs: number;
}): Promise<boolean> {
  const beansprucht = await store.withStoreLock(() => {
    const state = store.load();
    const marker = oeffneAlarm(state, LAUF_MARKER);
    if (marker?.lastSeenAt && nowMs - Date.parse(marker.lastSeenAt) < minIntervalMs) return false;
    claimeAlarm(state, { code: LAUF_MARKER, nowMs });
    return true;
  });
  store.save();
  return beansprucht;
}

async function messePreis({
  plan,
  config,
  lesePreis,
}: {
  plan: Plan;
  config: Config;
  lesePreis: LesePreis;
}): Promise<Messung | null | undefined> {
  const priceId = priceIdForPlan(plan.slug, config);
  if (!priceId) return null;
  try {
    return await lesePreis(priceId);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Abruf fehlgeschlagen slug=${plan.slug}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function pruefeTarife({
  config,
  lesePreis,
}: {
  config: Config;
  lesePreis: LesePreis;
}): Promise<{ befunde: Befund[]; unbekannt: number }> {
  const befunde: Befund[] = [];
  let unbekannt = 0;
  for (const plan of PLAN_CATALOG) {
    const { urteil, detail } = beurteilePreis(plan, await messePreis({ plan, config, lesePreis }));
    if (urteil === PREIS_URTEIL.UNBEKANNT) unbekannt += 1;
    else if (urteil === PREIS_URTEIL.ABWEICHUNG) befunde.push({ slug: plan.slug, detail });
  }
  return { befunde, unbekannt };
}

function driftZeile(befund: Befund): string {
  return `Hermes Betriebsmeldung\nKatalogpreis weicht vom Stripe-Price ab: ${befund.detail}`;
}

function unbekanntZeile({
  unbekannt,
  lauf,
  grenze,
}: {
  unbekannt: number;
  lauf: number;
  grenze: number;
}): string {
  return (
    "Hermes Betriebsmeldung\n" +
    `Preis-Waechter ohne Urteil: tarife=${String(unbekannt)} lauf=${String(lauf)} von ${String(grenze)}`
  );
}

async function meldeAbweichungen({
  store, config, audit, messaging, mailer, befunde, nowMs,
}: Sweep & { befunde: Befund[]; nowMs: number }): Promise<void> {
  for (const befund of befunde)
    await meldeVollBefundTypisiert({
      store, config, audit, messaging, mailer,
      bucket: priceDriftBucket(befund.slug), aktion: BEFUND_EVENT, zeile: driftZeile(befund), nowMs,
    });
}

export async function schliesseMarker({
  store,
  istZuSchliessen,
  nowMs,
}: {
  store: Store;
  istZuSchliessen: (code: string) => boolean;
  nowMs: number;
}): Promise<number> {
  const geschlossen = await store.withStoreLock(() => {
    const state = store.load();
    const offene = state.outageAlerts.filter(
      (alert) => alert.closedAt === null && istZuSchliessen(alert.code),
    );
    for (const marker of offene) schliesseAlarm(state, { code: marker.code, nowMs });
    return offene.length;
  });
  store.save();
  return geschlossen;
}

async function schliesseBehobene({
  store,
  audit,
  aktuelle,
  unbekannt,
  nowMs,
}: {
  store: Store;
  audit: Audit;
  aktuelle: ReadonlySet<string>;
  unbekannt: number;
  nowMs: number;
}): Promise<void> {
  if (unbekannt > 0) return;
  const geschlossen = await schliesseMarker({
    store, nowMs,
    istZuSchliessen: (code: string) => istPreisBefund(code) && !aktuelle.has(code),
  });
  if (geschlossen === 0) return;
  console.log(`${LOG_PREFIX} behoben marker=${String(geschlossen)}`);
  audit(BEHOBEN_EVENT, null, `marker=${String(geschlossen)}`);
}

function offeneUnbekanntSlots(store: Store): Alert[] {
  return store.load().outageAlerts.filter(
    (alert) => alert.closedAt === null && istUnbekanntSlot(alert.code),
  );
}

async function behandleUnwissenheit({
  store, config, audit, messaging, mailer, unbekannt, nowMs,
}: Sweep & { unbekannt: number; nowMs: number }): Promise<void> {
  if (unbekannt === 0) {
    const geschlossen = await schliesseMarker({ store, nowMs, istZuSchliessen: istUnbekanntSlot });
    if (geschlossen > 0) audit(BEHOBEN_EVENT, null, `unbekannt_slots=${String(geschlossen)}`);
    return;
  }
  const grenze = config.billing.priceDriftUnknownEscalateAfter;
  if (grenze <= 0) return;
  const offen = offeneUnbekanntSlots(store).length;
  if (offen >= grenze) return;
  const lauf = offen + ERSTER_SLOT;
  const bucket = unbekanntSlot(lauf);
  const zeile = unbekanntZeile({ unbekannt, lauf, grenze });
  if (lauf < grenze) {
    await meldeBetreiberNotizTypisiert({ store, audit, bucket, aktion: UNBEKANNT_EVENT, zeile, nowMs });
    return;
  }
  await meldeVollBefundTypisiert({
    store, config, audit, messaging, mailer,
    bucket, aktion: UNBEKANNT_ESKALIERT_EVENT, zeile, nowMs,
  });
}

export async function runPriceDriftSweep({
  store, config, audit, messaging, mailer, lesePreis, anlass, nowMs = Date.now(),
}: Sweep & { lesePreis: LesePreis; anlass: string; nowMs?: number }): Promise<void> {
  try {
    if (!config.billing.paymentEnabled) return;
    const minIntervalMs = config.billing.priceDriftMinIntervalMs;
    if (minIntervalMs <= 0) return;
    if (!(await beanspruchen({ store, nowMs, minIntervalMs }))) return;
    const { befunde, unbekannt } = await pruefeTarife({ config, lesePreis });
    console.log(
      `${LOG_PREFIX} anlass=${anlass} geprueft=${String(PLAN_CATALOG.length)} abweichungen=${String(befunde.length)} unbekannt=${String(unbekannt)}`,
    );
    await meldeAbweichungen({ store, config, audit, messaging, mailer, befunde, nowMs });
    await schliesseBehobene({
      store, audit, nowMs, unbekannt,
      aktuelle: new Set(befunde.map((befund) => priceDriftBucket(befund.slug))),
    });
    await behandleUnwissenheit({ store, config, audit, messaging, mailer, unbekannt, nowMs });
  } catch (err) {
    console.error(LOG_PREFIX, err instanceof Error ? err.message : String(err));
  }
}

export function makePriceDriftWatch({
  store, config, audit, messaging, mailer, lesePreis,
}: Sweep & { lesePreis: LesePreis }): {
  runPriceDriftSweep: () => Promise<void>;
  runBootProbe: () => Promise<void>;
} {
  return {
    runPriceDriftSweep: () =>
      runPriceDriftSweep({ store, config, audit, messaging, mailer, lesePreis, anlass: "sweep" }),
    runBootProbe: () =>
      runPriceDriftSweep({ store, config, audit, messaging, mailer, lesePreis, anlass: "boot" }),
  };
}
