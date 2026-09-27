// Beispieldaten fuer das Reviewer-Konto der App-Einreichung: reine Logik, kein Env, kein
// Store-Import. Der Aufrufer reicht die Store-Fassade herein (scripts/seed-reviewer-demo.mjs
// bzw. die Tests); diese Datei entscheidet nur, WAS fehlt, und schreibt es ueber genau vier
// Store-Funktionen: createCall, recordProviderCallResult, endCallRecord, addActionItem.
//
// Verboten und deshalb hier nicht vorhanden: jede Aenderung an Abo, Verifikation (KYC),
// Mandanten-Status, Profil, Nummer, Budget oder Nutzung. Das Reviewer-Konto bekommt dieselben
// Sicherungen wie jeder Kunde; ein echtes Abo mit echter Verifikation richtet der Betreiber ein.
// Die Datei legt NIE einen Mandanten an - ein unbekannter Mandant ist ein Abbruch.
//
// Warum nur Inbound, sofort beendet und ohne answeredAt:
// - createCall setzt startedAt=jetzt und status "active". Ein Outbound-Datensatz zaehlte
//   damit ins Stunden- und Ziel-Limit (countOutboundCallsSince) und naehme dem Reviewer
//   Testanrufe weg; deshalb nur Inbound.
// - Ein aktiver Datensatz wuerde vom Watchdog aufgegriffen; deshalb endCallRecord im selben Zug.
// - answeredAt zaehlt einen Anruf in die Kosten-Nachtrags-Quote; ohne Kostennachweis kaeme ein
//   Betreiber-Alarm. Deshalb kein markAnswered, kein costProfile, kein Transkript.
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

const INBOUND = "inbound";
const ENDED_STATUS = "completed";
const ACTION_ITEM_TYPE = "todo";

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
    (call) => call.direction === INBOUND && call.from === entry.from && call.summary === entry.summary,
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

function createEndedInboundCall(store, tenantId, entry) {
  const call = store.createCall({ direction: INBOUND, from: entry.from, to: null, tenantId });
  store.recordProviderCallResult(call.id, { summary: entry.summary, objectiveAchieved: null });
  store.endCallRecord(call.id, ENDED_STATUS);
  return call.id;
}

// Zaehlt nur tatsaechlich neue Eintraege: addActionItem meldet eine Dublette am selben Anruf
// (auch einen bereits erledigten Eintrag) als duplicate und legt dann nichts an.
function addMissingItems(store, callId, texts) {
  return texts.filter((text) => !store.addActionItem(callId, text, ACTION_ITEM_TYPE).duplicate).length;
}

// Schreibt die fehlenden Datensaetze; Speichern (store.save) ist Sache des Aufrufers.
export function applyReviewerSeed(store, tenantId) {
  const counts = { callsCreated: 0, itemsCreated: 0 };
  for (const step of planReviewerSeed(store, tenantId)) {
    const callId = step.callId ?? createEndedInboundCall(store, tenantId, step.entry);
    if (step.callId === null) counts.callsCreated += 1;
    counts.itemsCreated += addMissingItems(store, callId, step.missingItems);
  }
  return counts;
}
