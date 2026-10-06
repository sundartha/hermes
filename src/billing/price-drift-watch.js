import { PLAN_CATALOG } from "../plans.js";
import { priceIdForPlan } from "./subscribe.js";
import { meldeBetreiberNotiz, meldeVollBefund } from "../telephony/outage-report.js";
import * as ops from "../store/state-ops.js";

const LOG_PREFIX = "[price-drift]";
const BEFUND_PREFIX = "price-drift:";
const LAUF_MARKER = "price-drift:lauf";
const UNBEKANNT_PREFIX = "price-drift:unbekannt:";
const BEFUND_EVENT = "price_drift";
const BEHOBEN_EVENT = "price_drift_recovered";
const UNBEKANNT_EVENT = "price_drift_unknown";
const UNBEKANNT_ESKALIERT_EVENT = "price_drift_unknown_escalated";
const ERSTER_SLOT = 1;

export const priceDriftBucket = (slug) => `${BEFUND_PREFIX}${slug}`;

const unbekanntSlot = (nummer) => `${UNBEKANNT_PREFIX}${nummer}`;
const istUnbekanntSlot = (code) => code.startsWith(UNBEKANNT_PREFIX);
const istPreisBefund = (code) =>
  code.startsWith(BEFUND_PREFIX) && code !== LAUF_MARKER && !istUnbekanntSlot(code);

export const PREIS_URTEIL = Object.freeze({ OK: "ok", ABWEICHUNG: "abweichung", UNBEKANNT: "unbekannt" });

const currencyGleich = (links, rechts) => links.toLowerCase() === rechts.toLowerCase();

const messungsDetail = (plan, messung) =>
  `slug=${plan.slug} katalog=${plan.amountCents}${plan.currency} ` +
  `anbieter=${messung.unitAmountCents}${messung.currency}`;

export function beurteilePreis(plan, messung) {
  if (!messung || !Number.isInteger(messung.unitAmountCents) || typeof messung.currency !== "string")
    return { urteil: PREIS_URTEIL.UNBEKANNT, detail: `slug=${plan.slug} anbieter=unlesbar` };
  const detail = messungsDetail(plan, messung);
  if (messung.unitAmountCents === plan.amountCents && currencyGleich(messung.currency, plan.currency))
    return { urteil: PREIS_URTEIL.OK, detail };
  return { urteil: PREIS_URTEIL.ABWEICHUNG, detail };
}

async function beanspruchen({ store, nowMs, minIntervalMs }) {
  const beansprucht = await store.withStoreLock(() => {
    const state = store.load();
    const marker = ops.openOutageAlert(state, LAUF_MARKER);
    if (marker && marker.lastSeenAt && nowMs - Date.parse(marker.lastSeenAt) < minIntervalMs) return false;
    ops.claimOutageAlert(state, { code: LAUF_MARKER, nowMs });
    return true;
  });
  store.save();
  return beansprucht;
}

async function messePreis({ plan, config, lesePreis }) {
  const priceId = priceIdForPlan(plan.slug, config);
  if (!priceId) return null;
  try {
    return await lesePreis(priceId);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Abruf fehlgeschlagen slug=${plan.slug}: ${err.message}`);
    return null;
  }
}

async function pruefeTarife({ config, lesePreis }) {
  const befunde = [];
  let unbekannt = 0;
  for (const plan of PLAN_CATALOG) {
    const { urteil, detail } = beurteilePreis(plan, await messePreis({ plan, config, lesePreis }));
    if (urteil === PREIS_URTEIL.UNBEKANNT) unbekannt += 1;
    else if (urteil === PREIS_URTEIL.ABWEICHUNG) befunde.push({ slug: plan.slug, detail });
  }
  return { befunde, unbekannt };
}

function driftZeile(befund) {
  return `Hermes Betriebsmeldung\nKatalogpreis weicht vom Stripe-Price ab: ${befund.detail}`;
}

function unbekanntZeile({ unbekannt, lauf, grenze }) {
  return (
    "Hermes Betriebsmeldung\n" +
    `Preis-Waechter ohne Urteil: tarife=${unbekannt} lauf=${lauf} von ${grenze}`
  );
}

async function meldeAbweichungen({ store, config, audit, messaging, mailer, befunde, nowMs }) {
  for (const befund of befunde)
    await meldeVollBefund({
      store, config, audit, messaging, mailer,
      bucket: priceDriftBucket(befund.slug), aktion: BEFUND_EVENT, zeile: driftZeile(befund), nowMs,
    });
}

async function schliesseMarker({ store, istZuSchliessen, nowMs }) {
  const geschlossen = await store.withStoreLock(() => {
    const state = store.load();
    const offene = state.outageAlerts.filter(
      (alert) => alert.closedAt === null && istZuSchliessen(alert.code),
    );
    for (const marker of offene) ops.closeOutageAlert(state, { code: marker.code, nowMs });
    return offene.length;
  });
  store.save();
  return geschlossen;
}

async function schliesseBehobene({ store, audit, aktuelle, unbekannt, nowMs }) {
  if (unbekannt > 0) return;
  const geschlossen = await schliesseMarker({
    store, nowMs,
    istZuSchliessen: (code) => istPreisBefund(code) && !aktuelle.has(code),
  });
  if (geschlossen === 0) return;
  console.log(`${LOG_PREFIX} behoben marker=${geschlossen}`);
  audit(BEHOBEN_EVENT, null, `marker=${geschlossen}`);
}

function offeneUnbekanntSlots(store) {
  return store.load().outageAlerts.filter(
    (alert) => alert.closedAt === null && istUnbekanntSlot(alert.code),
  );
}

async function behandleUnwissenheit({ store, config, audit, messaging, mailer, unbekannt, nowMs }) {
  if (unbekannt === 0) {
    const geschlossen = await schliesseMarker({ store, nowMs, istZuSchliessen: istUnbekanntSlot });
    if (geschlossen > 0) audit(BEHOBEN_EVENT, null, `unbekannt_slots=${geschlossen}`);
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
    await meldeBetreiberNotiz({ store, audit, bucket, aktion: UNBEKANNT_EVENT, zeile, nowMs });
    return;
  }
  await meldeVollBefund({
    store, config, audit, messaging, mailer,
    bucket, aktion: UNBEKANNT_ESKALIERT_EVENT, zeile, nowMs,
  });
}

export async function runPriceDriftSweep({
  store, config, audit, messaging, mailer, lesePreis, anlass, nowMs = Date.now(),
}) {
  try {
    if (!config.billing.paymentEnabled) return;
    const minIntervalMs = config.billing.priceDriftMinIntervalMs;
    if (minIntervalMs <= 0) return;
    if (!(await beanspruchen({ store, nowMs, minIntervalMs }))) return;
    const { befunde, unbekannt } = await pruefeTarife({ config, lesePreis });
    console.log(
      `${LOG_PREFIX} anlass=${anlass} geprueft=${PLAN_CATALOG.length} abweichungen=${befunde.length} unbekannt=${unbekannt}`,
    );
    await meldeAbweichungen({ store, config, audit, messaging, mailer, befunde, nowMs });
    await schliesseBehobene({
      store, audit, nowMs, unbekannt,
      aktuelle: new Set(befunde.map((befund) => priceDriftBucket(befund.slug))),
    });
    await behandleUnwissenheit({ store, config, audit, messaging, mailer, unbekannt, nowMs });
  } catch (err) {
    console.error(LOG_PREFIX, err.message);
  }
}

export function makePriceDriftWatch({ store, config, audit, messaging, mailer, lesePreis }) {
  return {
    runPriceDriftSweep: () =>
      runPriceDriftSweep({ store, config, audit, messaging, mailer, lesePreis, anlass: "sweep" }),
    runBootProbe: () =>
      runPriceDriftSweep({ store, config, audit, messaging, mailer, lesePreis, anlass: "boot" }),
  };
}
