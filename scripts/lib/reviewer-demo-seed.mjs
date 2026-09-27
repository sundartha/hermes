// Beispieldaten fuer das Reviewer-Konto der App-Einreichung: reine Logik, kein Env, kein
// Store-Import. Der Aufrufer reicht die Store-Fassade und die Laengen der Kosten-Beobachtung
// herein (scripts/seed-reviewer-demo.mjs bzw. die Tests); diese Datei entscheidet nur, WAS
// fehlt, und schreibt es ueber genau vier Store-Funktionen: createCall,
// recordProviderCallResult, setCallEndedAt, addActionItem (persistiert ueber save und
// drainFlushes, applyReviewerSeedAndPersist).
//
// Verboten und deshalb hier nicht vorhanden: jede Aenderung an Abo, Verifikation (KYC),
// Mandanten-Status, Profil, Nummer, Budget oder Nutzung. Das Reviewer-Konto bekommt dieselben
// Sicherungen wie jeder Kunde; ein echtes Abo mit echter Verifikation richtet der Betreiber ein.
// Die Datei legt NIE einen Mandanten an - ein unbekannter Mandant ist ein Abbruch.
//
// Warum nur Inbound, beendet, mit Ende VOR der Kosten-Beobachtung und ohne answeredAt:
// - createCall setzt startedAt=jetzt und status "active". Ein Outbound-Datensatz zaehlte
//   damit ins Stunden- und Ziel-Limit (countOutboundCallsSince) und naehme dem Reviewer
//   Testanrufe weg; deshalb nur Inbound.
// - Ein aktiver Datensatz wuerde vom Watchdog aufgegriffen; deshalb setCallEndedAt im selben
//   Zug.
// - Die Kosten-Ueberwachung (kostenBuchBericht, src/billing/kosten-deckung.js) zaehlt JEDEN
//   beendeten Anruf, dessen endedAt im Beleg- oder Herzschlag-Fenster liegt - unabhaengig von
//   answeredAt. Ein Seed-Anruf traegt keine Provider-Leg-Referenz und bekommt deshalb nie
//   einen Kostenbeleg; mit endedAt=jetzt meldete der Sweep nach der Karenz "erfassung-tot"
//   und "profil-fehlt" und danach tagelang "deckung-unter-schwelle" (voll: Mail und SMS an
//   den Betreiber) - Fehlalarme genau der Geldpfad-Ueberwachung. Deshalb liegt endedAt VOR
//   dem aeltesten Rand beider Fenster (reviewerSeedEndedAtIso). Die Ueberwachung selbst
//   bleibt unangetastet; der Seed-Anruf faellt nur in keines ihrer Fenster.
// - Sichtbar bleibt startedAt (list_calls zeigt nur ihn); endedAt liegt davor, duration_s
//   ist deshalb 0 (durationS klemmt bei 0). endedAt ist zugleich der Anker der
//   Aufbewahrung: ein Seed-Anruf faellt RETENTION_DAYS nach seinem (vordatierten) Ende weg,
//   also frueher als ein echter Anruf.
// - Kein markAnswered, kein costProfile, kein Transkript: answeredAt zaehlte den Anruf in die
//   Kosten-Nachtrags-Quote (coverageBreakdown); ohne answeredAt bleibt er dort
//   "nie_beantwortet" und aus dem Nenner. Ein costProfile behauptete einen Kostenweg, den es
//   nie gab, und verhinderte keinen Alarm (ein bekanntes Profil fuehrt denselben Traeger);
//   sein Fehlen meldet kein "profil-fehlt", weil endedAt vor dem Herzschlag-Fenster liegt.
import { MS_PER_HOUR } from "../../src/utils/timer.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

const INBOUND = "inbound";
const ENDED_STATUS = "completed";
const ACTION_ITEM_TYPE = "todo";
const HOURS_PER_DAY = 24;
// Sicherheitsabstand hinter dem aeltesten Fensterrand (Uhrversatz, spaete Sweeps).
const SEED_END_MARGIN_MS = HOURS_PER_DAY * MS_PER_HOUR;

// Anrufer-Nummern aus dem fiktiven NANP-Bereich +1 202 555 0100..0199 (fuer Film/Beispiele
// reserviert, nie einem Anschluss zugeteilt). Keine realen Namen, keine E-Mail-Adressen, keine
// Karten-, Konto-, Gesundheits- oder Ausweisdaten.
export const REVIEWER_SEED_CALLS = Object.freeze([
  Object.freeze({
    from: "+12025550142",
    summary:
      "A caller from a dental practice asked to move a check-up appointment from Tuesday to Thursday afternoon.",
    actionItems: Object.freeze(["Confirm the new dental check-up time for Thursday afternoon."]),
  }),
  Object.freeze({
    from: "+12025550187",
    summary:
      "A bike repair shop called to say the repair is finished and the bike can be picked up until 6 pm.",
    actionItems: Object.freeze(["Pick up the bike from the repair shop before 6 pm."]),
  }),
  Object.freeze({
    from: "+12025550163",
    summary:
      "A neighbor called about the shared garden cleanup on Saturday morning and asked whether you can join.",
    actionItems: Object.freeze([
      "Reply to the neighbor about joining the garden cleanup on Saturday.",
      "Bring gardening gloves to the cleanup.",
    ]),
  }),
]);

// fail-closed: leere Kennung, Betreiber-Mandant oder unbekannter Mandant -> Abbruch, bevor
// irgendetwas gelesen oder geschrieben wird.
function assertSeedableTenant(store, tenantId) {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error("Mandanten-Kennung fehlt.");
  }
  if (tenantId === BOOTSTRAP_TENANT_ID) {
    throw new Error("Der Betreiber-Mandant bekommt keine Beispieldaten.");
  }
  if (!store.tenantExists(tenantId)) {
    throw new Error("Mandant unbekannt - das Skript legt keinen Mandanten an.");
  }
}

// Idempotenzschluessel eines Anrufs: Richtung, Anrufer und Zusammenfassung im Mandanten-Scope.
function findSeedCall(calls, entry) {
  return calls.find(
    (call) =>
      call.direction === INBOUND && call.from === entry.from && call.summary === entry.summary,
  );
}

// Liste der FEHLENDEN Datensaetze: ein Schritt je Seed-Anruf, der fehlt oder dem offene
// Action Items fehlen. callId ist null, wenn der Anruf selbst noch anzulegen ist.
export function planReviewerSeed(store, tenantId) {
  assertSeedableTenant(store, tenantId);
  const { calls, actionItems } = store.exportTenantData(tenantId);
  const openTexts = new Set(actionItems.filter((item) => !item.done).map((item) => item.text));
  return REVIEWER_SEED_CALLS.map((entry) => ({
    entry,
    callId: findSeedCall(calls, entry)?.id ?? null,
    missingItems: entry.actionItems.filter((text) => !openTexts.has(text)),
  })).filter((step) => step.callId === null || step.missingItems.length > 0);
}

// Der Ende-Zeitpunkt der Seed-Anrufe: vor dem aeltesten Rand von Beleg-Fenster
// (belegFensterMs = PROVIDER_COST_RECORD_WINDOW_MS) und Herzschlag-Fenster
// (heartbeatFensterH = config.billing.kostenHeartbeatFensterH), minus Sicherheitsabstand.
// fail-closed: ohne gueltige Fensterlaengen kein Zeitpunkt - "jetzt" als Rueckfall waere
// genau der Alarm-Fall.
export function reviewerSeedEndedAtIso({ nowMs, belegFensterMs, heartbeatFensterH }) {
  const fensterMs = Math.max(belegFensterMs, heartbeatFensterH * MS_PER_HOUR);
  if (!Number.isFinite(nowMs) || !Number.isFinite(fensterMs) || fensterMs <= 0) {
    throw new Error("Fensterlaengen der Kosten-Beobachtung fehlen.");
  }
  return new Date(nowMs - fensterMs - SEED_END_MARGIN_MS).toISOString();
}

function assertEndedAtIso(endedAtIso) {
  if (typeof endedAtIso !== "string" || !Number.isFinite(Date.parse(endedAtIso))) {
    throw new Error("Ende-Zeitpunkt der Seed-Anrufe fehlt (reviewerSeedEndedAtIso).");
  }
}

function createEndedInboundCall(store, { tenantId, entry, endedAtIso }) {
  const call = store.createCall({ direction: INBOUND, from: entry.from, to: null, tenantId });
  store.recordProviderCallResult(call.id, { summary: entry.summary, objectiveAchieved: null });
  store.setCallEndedAt(call.id, ENDED_STATUS, endedAtIso);
  return call.id;
}

// Zaehlt nur tatsaechlich neue Eintraege: addActionItem meldet eine Dublette am selben Anruf
// (auch einen bereits erledigten Eintrag) als duplicate und legt dann nichts an.
function addMissingItems(store, callId, texts) {
  return texts.filter((text) => !store.addActionItem(callId, text, ACTION_ITEM_TYPE).duplicate)
    .length;
}

// Schreibt die fehlenden Datensaetze; Speichern (store.save) ist Sache des Aufrufers.
// endedAtIso kommt aus reviewerSeedEndedAtIso und wird VOR jedem Schreiben geprueft.
// Ein schon vorhandener Seed-Anruf bleibt, wie er ist - auch sein endedAt: ein erneuter Lauf
// legt nur an, was fehlt (etwa nach Ablauf der Aufbewahrung), und datiert nichts um
// (setCallEndedAt wirkt nur auf aktive Anrufe). Wie viele vorhandene Seed-Anrufe inzwischen
// in den Fenstern der Kosten-Ueberwachung liegen, meldet countSeedCallsInsideCostWindow.
export function applyReviewerSeed(store, tenantId, endedAtIso) {
  assertEndedAtIso(endedAtIso);
  const counts = { callsCreated: 0, itemsCreated: 0 };
  for (const step of planReviewerSeed(store, tenantId)) {
    const callId =
      step.callId ?? createEndedInboundCall(store, { tenantId, entry: step.entry, endedAtIso });
    if (step.callId === null) counts.callsCreated += 1;
    counts.itemsCreated += addMissingItems(store, callId, step.missingItems);
  }
  return counts;
}

// applyReviewerSeed plus Persistenz mit Ergebnispruefung: save() loest auch bei einem
// fehlgeschlagenen pg-Flush auf (dort nur geloggt, die Transaktion rollt zurueck); erst
// drainFlushes() wirft den Fehler (json: save schreibt synchron und wirft selbst,
// drainFlushes ist ein No-op). So meldet der Aufrufer nie "angelegt" fuer einen Lauf, dessen
// Flush gescheitert ist.
export async function applyReviewerSeedAndPersist(store, tenantId, endedAtIso) {
  const counts = applyReviewerSeed(store, tenantId, endedAtIso);
  await store.save();
  await store.drainFlushes();
  return counts;
}

// Nur lesend: vorhandene Seed-Anrufe, deren endedAt NACH endedAtIso liegt, also innerhalb der
// HEUTIGEN Fenster der Kosten-Ueberwachung. Das passiert, wenn Beleg- oder Herzschlag-Fenster
// nach ihrem Anlegen vergroessert wurden; der Sweep kann sie dann als Befund melden
// (Fehlalarm). endedAtIso kommt aus reviewerSeedEndedAtIso mit den aktuellen Fensterlaengen.
export function countSeedCallsInsideCostWindow(store, tenantId, endedAtIso) {
  assertEndedAtIso(endedAtIso);
  assertSeedableTenant(store, tenantId);
  const { calls } = store.exportTenantData(tenantId);
  const windowStartMs = Date.parse(endedAtIso);
  return REVIEWER_SEED_CALLS.map((entry) => findSeedCall(calls, entry)).filter(
    (call) => call !== undefined && Date.parse(call.endedAt) > windowStartMs,
  ).length;
}
