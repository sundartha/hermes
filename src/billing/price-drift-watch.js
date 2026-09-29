// GP-P6 (PLAN-GELDPFAD.md, "Preis-Waechter Katalog gegen Stripe"): der Plan-Katalog
// (src/plans.js) sagt ausdruecklich ueber sich selbst "dieser Katalog liest Stripe NICHT" -
// der ANGEZEIGTE Preis und der Preis, den Stripe wirklich abbucht, sind zwei
// unabhaengige Wahrheiten. Weicht einer ab, verkauft die Preisseite etwas anderes, als
// die Karte belastet wird, und niemand merkt es. Dieser Waechter vergleicht beide.
//
// TAKT: taeglich (Owner-Entscheidung 11.09.2026, Frage 12) - Stripe-Preise aendern sich
// seltener als Telefonie-Konfiguration, und jede Pruefung ist ein Anbieter-Aufruf. Der
// Waechter haengt im bestehenden Stunden-Sweep (boot.js#runSweepTick) und im Boot-Lauf;
// die Mindestfrist sitzt IM Waechter (PRICE_DRIFT_MIN_INTERVAL_MS), nicht im Takt - kein
// zweiter Timer, keine neue Ressource.
//
// FAIL-SOFT, absolut: ein Fehler HIER darf weder den Boot noch den Sweep abbrechen
// nichts ab, kauft nichts, aendert keinen Preis - er meldet.
//
// AKZEPTIERTES RESTRISIKO (Pre-Mortem 4): wird PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER zur
// Laufzeit GESENKT, waehrend mehr Unwissenheits-Slots offen sind als die neue Grenze,
// schweigt der Waechter bis zum naechsten erfolgreichen Lauf (fail-quiet). Bewusst so:
// lieber eine ausbleibende Wiederholung als eine Doppel-Meldung.
import { PLAN_CATALOG } from "../plans.js";
import { priceIdForPlan } from "./subscribe.js";
import { meldeBetreiberNotiz, meldeVollBefund } from "../telephony/outage-report.js";
import * as ops from "../store/state-ops.js";

const LOG_PREFIX = "[price-drift]";
const BEFUND_PREFIX = "price-drift:";
// Zeitanker des letzten beanspruchten Laufs, KEIN Befund (Muster drift:lauf).
const LAUF_MARKER = "price-drift:lauf";
const UNBEKANNT_PREFIX = "price-drift:unbekannt:";
const BEFUND_EVENT = "price_drift";
const BEHOBEN_EVENT = "price_drift_recovered";
const UNBEKANNT_EVENT = "price_drift_unknown";
const UNBEKANNT_ESKALIERT_EVENT = "price_drift_unknown_escalated";
// Nummer des ersten Unwissenheits-Slots (G25: kein nacktes +1-Literal im Code).
const ERSTER_SLOT = 1;

// EXPORTIERT, weil der Marker-Code ein durabler Vertrag ist (outage_alert.code): eine
// zweite, anderswo getippte Zusammensetzung koennte abdriften, ohne dass ein Test es
export const priceDriftBucket = (slug) => `${BEFUND_PREFIX}${slug}`;

const unbekanntSlot = (nummer) => `${UNBEKANNT_PREFIX}${nummer}`;
const istUnbekanntSlot = (code) => code.startsWith(UNBEKANNT_PREFIX);
const istPreisBefund = (code) =>
  code.startsWith(BEFUND_PREFIX) && code !== LAUF_MARKER && !istUnbekanntSlot(code);

export const PREIS_URTEIL = Object.freeze({ OK: "ok", ABWEICHUNG: "abweichung", UNBEKANNT: "unbekannt" });

// Stripe liefert die Waehrung als klein geschriebenen ISO-Code, der Katalog traegt sie
// ebenso (src/plans.js). Der Vergleich normalisiert trotzdem die Schreibweise: eine
// Gross-/Kleinschreibung ist keine Preisabweichung und darf keinen Betreiber-Alarm
// ausloesen.
const currencyGleich = (links, rechts) => links.toLowerCase() === rechts.toLowerCase();

// PII-frei (Regel 10): Slug, Betraege, Waehrungen - keine Kunden-, Konto- oder
// Price-Referenzen (eine price_-Id ist opak, gehoert aber nicht in eine Alarm-Mail).
const messungsDetail = (plan, messung) =>
  `slug=${plan.slug} katalog=${plan.amountCents}${plan.currency} ` +
  `anbieter=${messung.unitAmountCents}${messung.currency}`;

// REIN (kein IO, keine Uhr, kein Wurf): EIN Katalog-Tarif gegen EINE Anbieter-Messung.
// Eine fehlende oder untypisierte Messung (Netzfehler -> null; gestaffelter/metered Price
// ohne unit_amount) ergibt UNBEKANNT statt eines geratenen Urteils (G26 "nie raten") -
// ein falsches "alles in Ordnung" waere hier schlimmer als eine gemeldete Unwissenheit.
export function beurteilePreis(plan, messung) {
  if (!messung || !Number.isInteger(messung.unitAmountCents) || typeof messung.currency !== "string")
    return { urteil: PREIS_URTEIL.UNBEKANNT, detail: `slug=${plan.slug} anbieter=unlesbar` };
  const detail = messungsDetail(plan, messung);
  if (messung.unitAmountCents === plan.amountCents && currencyGleich(messung.currency, plan.currency))
    return { urteil: PREIS_URTEIL.OK, detail };
  return { urteil: PREIS_URTEIL.ABWEICHUNG, detail };
}

// SINGLE-FLIGHT + MINDESTFRIST in EINEM atomaren Schritt - dieselbe Bauform wie
// bereits durablen, global sichtbaren Tabelle. Innerhalb eines Prozesses ist der Claim
// durch withStoreLock atomar, zwischen Instanzen wirkt die Mindestfrist ueber den
// hydrierten Marker.
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

// EINE Anbieter-Messung. Kein konfigurierter Price und ein werfender Abruf sind derselbe
// Zustand: "wir wissen es nicht" (null) - das Urteil faellt beurteilePreis. Die
// Fehlermeldung des Adapters traegt nur Operation und Status, nie den Schluessel
// (billing/stripe.js#failureMessage).
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

// Anbieter-IO-Schleife ueber den gesamten Katalog. Sequenziell: zwei Tarife sind kein
// Anlass fuer Parallelitaet gegen ein Anbieter-Rate-Limit.
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

// Eine Preisabweichung bucht Geld falsch ab - das ist die VOLL-Stufe (WARN -> Audit ->
// Mail -> SMS), nie die stille Notiz. Die Entprellung des geteilten Meldewegs
// (meldeVollBefund) schuetzt gegen den Sturm, nicht gegen die Wiederholung: ein
// ungeloester Drift meldet sich weiter, bis er behoben ist (bewusst, Pre-Mortem 2).
async function meldeAbweichungen({ store, config, audit, messaging, mailer, befunde, nowMs }) {
  for (const befund of befunde)
    await meldeVollBefund({
      store, config, audit, messaging, mailer,
      bucket: priceDriftBucket(befund.slug), aktion: BEFUND_EVENT, zeile: driftZeile(befund), nowMs,
    });
}

// Offene Marker schliessen, die das Praedikat auswaehlt - EINE Formulierung fuer beide
// Schliess-Faelle (Befund behoben / Unwissenheit vorbei), statt zweier byte-gleicher
// withStoreLock-Bloecke (G5).
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

// Entwarnung NUR aus einem Lauf, der ueberhaupt urteilen konnte: konnte auch nur EIN
// Tarif nicht gemessen werden, wird in diesem Lauf GAR NICHTS geschlossen. Sonst machte
// ein reiner Netzfehler aus einem fortbestehenden Preis-Drift eine stille Entwarnung
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

// Der Zaehler der aufeinanderfolgenden unbekannten Laeufe IST die Anzahl der offenen
// Slot-Marker - keine zweite Buchfuehrung, kein neues Store-Feld, kein Schema-Wechsel
// (Muster GP-P3: "der Versuchszaehler IST die Anzahl der failed-Nummern").
function offeneUnbekanntSlots(store) {
  return store.load().outageAlerts.filter(
    (alert) => alert.closedAt === null && istUnbekanntSlot(alert.code),
  );
}

// Ein einzelner Netzfehler ist keine Betreiber-Meldung wert, ein dauerhaft fehlendes
// Lese-Scope sehr wohl (Owner-Frage 13). Deshalb: Laeufe unterhalb der Grenze hinterlassen
// nur eine gezaehlte Notiz (WARN + Audit + Marker, KEIN Versand), der Lauf AUF der Grenze
// meldet GENAU EINMAL voll, danach ist Ruhe bis zum naechsten erfolgreichen Lauf.
async function behandleUnwissenheit({ store, config, audit, messaging, mailer, unbekannt, nowMs }) {
  if (unbekannt === 0) {
    const geschlossen = await schliesseMarker({ store, nowMs, istZuSchliessen: istUnbekanntSlot });
    if (geschlossen > 0) audit(BEHOBEN_EVENT, null, `unbekannt_slots=${geschlossen}`);
    return;
  }
  const grenze = config.billing.priceDriftUnknownEscalateAfter;
  // Rollback-Hebel: 0 = Unwissenheits-Eskalation komplett aus.
  if (grenze <= 0) return;
  const offen = offeneUnbekanntSlots(store).length;
  // Bereits eskaliert: kein weiterer Marker, keine zweite Meldung.
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
    // Ohne aktiven Geldpfad gibt es keinen Stripe-Schluessel und nichts zu vergleichen.
    if (!config.billing.paymentEnabled) return;
    const minIntervalMs = config.billing.priceDriftMinIntervalMs;
    // Rollback-Hebel (Muster outboundDriftMinIntervalMs): 0 haelt den Waechter komplett aus.
    if (minIntervalMs <= 0) return;
    if (!(await beanspruchen({ store, nowMs, minIntervalMs }))) return;
    const { befunde, unbekannt } = await pruefeTarife({ config, lesePreis });
    // Umfangs-Zeile IMMER, auch im gruenen Fall (Lehre pruefkommando-ohne-positiv-
    // kontrolle): ein Waechter, der nichts findet, muss von einem, der nichts sucht,
    // unterscheidbar bleiben.
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

// Fabrik (Muster makeDriftWatch/makePaidWithoutNumberWatch): EINMAL beim Boot verdrahtet
// (INV-7). lesePreis ist der rein LESENDE Stripe-Abruf des bestehenden Adapters - kein
// zweiter HTTP-Client, kein Geld-Aufruf.
export function makePriceDriftWatch({ store, config, audit, messaging, mailer, lesePreis }) {
  return {
    runPriceDriftSweep: () =>
      runPriceDriftSweep({ store, config, audit, messaging, mailer, lesePreis, anlass: "sweep" }),
    runBootProbe: () =>
      runPriceDriftSweep({ store, config, audit, messaging, mailer, lesePreis, anlass: "boot" }),
  };
}
