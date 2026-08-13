// Pruefung fuer die Abbildung "Gespraechsergebnis -> MCP-Felder": bindet ein
// ConversationOutcome (src/conversation/conversation-ports.js) plus den eigenen
// Anruf-Datensatz auf genau die MCP-Felder ab, die heute aus der eigenen
// Gespraechsfuehrung stammen und die mit dem Anbieterwechsel verschwindet. Der
// MCP-Vertrag selbst (Feldnamen/-formen in src/mcp-tools.js) bleibt UNVERAENDERT -
// diese Pruefung stellt sicher, dass die neue Abbildung ihn trifft.
//
// GEPINNT: Modulpfad und Signatur der noch fehlenden Abbildungsfunktion (Bau-Auftrag):
//   Pfad:      src/conversation/outcome-to-mcp-fields.js
//   Funktion:  export function mapConversationOutcomeToMcpFields(conversationOutcome, call, texts)
// conversationOutcome ist ein ConversationOutcome (conversation-ports.js: callId,
// connected, neverConnectedReason?, achieved, summary). call ist der EIGENE
// Anruf-Datensatz (mindestens transcript, startedAt, endedAt, result - dieselben
// Felder, auf denen mcp-tools.js heute schon pickCallStatus/pickTranscript aufbaut).
// texts traegt die Rollen-Praefixe fuer die Transkript-Formatierung
// (roleAgent/roleCounterparty), genau wie der texts-Parameter, den pickCallStatus
// heute schon entgegennimmt (src/mcp-tools.js:142). Rein synchron: alle Eingaben
// liegen bereits vor, kein I/O in dieser Abbildung. Rueckgabe ist ein Objekt, das
// MINDESTENS die sieben unten gepinnten Felder traegt.
//
// QUELLEN JE FELD (das Herzstueck dieser Pruefung):
//   last_transcript_lines - call.transcript, letzte LAST_TRANSCRIPT_LINES=6 Zeilen
//     (src/mcp-tools.js:35), Format "<Rolle>: <Text>" (pickCallStatus, mcp-tools.js:147-149).
//   status                 - aus conversationOutcome.connected: true -> "completed",
//     false -> "failed" (Werte-Menge laut get_call_status-Beschreibung, mcp-tools.js:798:
//     dialing|in_progress|completed|failed|cancelled). Die FEINERE Klassifikation
//     (no-answer/busy/canceled) traegt NICHT status, sondern failure_reason - dieselbe
//     Trennung wie heute zwischen call.status und call.failureReason (CDF1).
//   result_summary         - conversationOutcome.summary, UNVERAENDERT (Anbieter-Text).
//   objective_achieved     - conversationOutcome.achieved, DREIWERTIG wie heute
//     (pickTranscript, mcp-tools.js:192): true -> true, false -> false, null -> "unclear".
//     Unbekannt (null) wird NIE zu false.
//   failure_reason         - NUR wenn !connected: aus conversationOutcome.neverConnectedReason,
//     durch failureReasonBase (src/telephony/failure-reason.js) genommen - das kappt einen
//     etwaigen Detail-Anhang ("failed:<kennung>" -> "failed") und laesst bekannte Token
//     (no-answer/busy/canceled) unveraendert. connected:true -> null.
//   outcome                - call.result?.outcome ?? null (die von summarizeCall,
//     src/claude.js, geschriebene EIGENE Ergebniskarte, resultCardView mcp-tools.js:178).
//     NIE aus conversationOutcome.summary - das ist der Anbieter-Text (result_summary),
//     eine andere Quelle fuer ein anderes Feld.
//   duration_s              - Math.max(0, Math.round((endedAt-startedAt)/1000)) aus
//     call.startedAt/call.endedAt (durationS, mcp-tools.js:132-136). ConversationOutcome
//     traegt KEIN Zeit-/Dauerfeld - eine Implementierung darf keins erfinden oder von
//     dort lesen.
//
// ROHKENNUNG (eigener Testfall unten): ein Pruefer hat belegt, dass src/mcp-tools.js
// (pickCallStatus, Zeile ~152) failure_reason heute UNGEFILTERT weiterreicht -
// inklusive roher Anbieter-Kennungen der Form "failed:<kennung>". Diese Abbildung
// darf diesen Fehler nicht wiederholen: ein unbekannter Detail-Anhang wird gekappt,
// nie durchgereicht.
//
// Diese Pruefung laeuft ohne Anbieter/Netz/Konto: ein Test nutzt die Attrappe
// (test/fixtures/mock-conversation-driver.js) ueber die gemeinsame Vertrags-Helfer
// (test/conversation-driver-contract.js), um ein ECHTES, attrappen-erzeugtes
// ConversationOutcome gegen die Abbildung zu pruefen; die uebrigen Testfaelle bauen
// ConversationOutcome-Werte direkt nach dem in conversation-ports.js dokumentierten
// Vertrag (Randfaelle, die die Attrappe heute nicht von sich aus erzeugt: false statt
// true, rohe Anbieter-Kennungen).
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Anfang, sonst
// landet die Datei im Gates-Lauf statt im Regressionslauf
// (Lehre catalog-id-prefix-misroutes-tests).
import assert from "node:assert/strict";
import { test } from "node:test";
import { failureReasonBase } from "../src/telephony/failure-reason.js";
import {
  baseStartParams,
  makeCallbackSpy,
  MOCK_OBJECTIVE,
  waitUntil,
} from "./conversation-driver-contract.js";
import { makeMockConversationDriver } from "./fixtures/mock-conversation-driver.js";
import { mapConversationOutcomeToMcpFields } from "../src/conversation/outcome-to-mcp-fields.js";

// Rollen-Praefixe wie texts.roleAgent/texts.roleCounterparty in pickCallStatus
// (src/mcp-tools.js:147-149) - hier eine Test-Attrappe statt des echten Locale-Buendels.
const TEXTS = Object.freeze({ roleAgent: "Agent", roleCounterparty: "Angerufener" });

// Muss mit src/mcp-tools.js (Konstante LAST_TRANSCRIPT_LINES, Zeile 35) uebereinstimmen.
const LAST_TRANSCRIPT_LINES = 6;

// Acht Zeilen (mehr als LAST_TRANSCRIPT_LINES), damit die Slice-Grenze sichtbar greift:
// die ersten zwei Zeilen duerfen NICHT im Ergebnis auftauchen.
const TRANSCRIPT_FIXTURE = Object.freeze([
  { role: "agent", text: "Zeile 1" },
  { role: "counterparty", text: "Zeile 2" },
  { role: "agent", text: "Zeile 3" },
  { role: "counterparty", text: "Zeile 4" },
  { role: "agent", text: "Zeile 5" },
  { role: "counterparty", text: "Zeile 6" },
  { role: "agent", text: "Zeile 7" },
  { role: "counterparty", text: "Zeile 8" },
]);

// Zeitstempel-Fixtur fuer duration_s - der Erwartungswert wird unten aus DENSELBEN
// Werten berechnet (keine per Hand ausgerechnete Zahl im Test).
const STARTED_AT = "2026-08-01T10:00:00.000Z";
const ENDED_AT = "2026-08-01T10:03:15.000Z";
// Umrechnung Millisekunden -> Sekunden, wie durationS in src/mcp-tools.js (Zeile 132-136).
const MS_PER_SECOND = 1000;

// Ein Laufwerk, das (vertragswidrig) eine eigene Dauer mitschickt - defensiver Beleg,
// dass duration_s NIE von dort gelesen wird.
const BOGUS_PROVIDER_DURATION_S = 999999;

// Formatierung wie pickCallStatus (mcp-tools.js:147-149): eigene Test-Nachbildung,
// damit last_transcript_lines nicht gegen eine per Hand getippte Zeilenliste, sondern
// gegen dieselbe Regel geprueft wird, die sie erzeugen soll.
function formatTranscriptLine(entry) {
  return `${entry.role === "agent" ? TEXTS.roleAgent : TEXTS.roleCounterparty}: ${entry.text}`;
}

function baseCall(overrides = {}) {
  return {
    transcript: TRANSCRIPT_FIXTURE,
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
    result: { outcome: "Eigene Ergebniskarte (summarizeCall)." },
    ...overrides,
  };
}

function baseOutcome(overrides = {}) {
  return {
    callId: "conv-outcome-pin",
    connected: true,
    achieved: true,
    summary: "Anbieter-Zusammenfassung des Laufwerks.",
    ...overrides,
  };
}

test("gepinnt: ein echtes, attrappen-erzeugtes ConversationOutcome wird korrekt abgebildet", async () => {
  const spy = makeCallbackSpy();
  const driver = makeMockConversationDriver({ callbacks: spy.callbacks });
  const callId = "outcome-mapping-pin";
  await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.OUTCOME));
  await waitUntil(() => spy.outcomes.length > 0);

  const conversationOutcome = spy.outcomes[0];
  const mapped = mapConversationOutcomeToMcpFields(conversationOutcome, baseCall(), TEXTS);

  assert.equal(mapped.status, "completed", "connected:true -> status completed");
  assert.equal(mapped.objective_achieved, true, "die Attrappe meldet achieved:true");
  assert.equal(mapped.result_summary, conversationOutcome.summary, "Anbieter-Text unveraendert");
  assert.equal(mapped.failure_reason, null, "verbunden -> kein Fehlergrund");
});

test("gepinnt: last_transcript_lines liefert die letzten 6 Zeilen im heutigen Rollen-Format", () => {
  const call = baseCall();
  const mapped = mapConversationOutcomeToMcpFields(baseOutcome(), call, TEXTS);
  const expectedLines = TRANSCRIPT_FIXTURE.slice(-LAST_TRANSCRIPT_LINES).map(formatTranscriptLine);

  assert.equal(mapped.last_transcript_lines.length, LAST_TRANSCRIPT_LINES);
  assert.deepEqual(
    mapped.last_transcript_lines,
    expectedLines,
    "die ersten zwei Zeilen fallen aus der Slice, Format ist RollenPraefix: Text",
  );
});

test("gepinnt: status wird aus connected auf die heutigen Werte abgebildet", () => {
  const connectedResult = mapConversationOutcomeToMcpFields(
    baseOutcome({ connected: true }),
    baseCall(),
    TEXTS,
  );
  assert.equal(connectedResult.status, "completed");

  const neverConnectedResult = mapConversationOutcomeToMcpFields(
    baseOutcome({ connected: false, achieved: null, neverConnectedReason: "no-answer" }),
    baseCall(),
    TEXTS,
  );
  assert.equal(neverConnectedResult.status, "failed");
});

test("gepinnt: result_summary kommt unveraendert von der Anbieter-Zusammenfassung", () => {
  const outcome = baseOutcome({ summary: "Termin wurde telefonisch besprochen." });
  const mapped = mapConversationOutcomeToMcpFields(outcome, baseCall(), TEXTS);
  assert.equal(mapped.result_summary, outcome.summary);
});

test("gepinnt: objective_achieved bleibt dreiwertig - unbekannt wird NIE zu nicht erreicht", () => {
  const achievedTrue = mapConversationOutcomeToMcpFields(
    baseOutcome({ achieved: true }),
    baseCall(),
    TEXTS,
  );
  assert.equal(achievedTrue.objective_achieved, true);

  const achievedFalse = mapConversationOutcomeToMcpFields(
    baseOutcome({ achieved: false }),
    baseCall(),
    TEXTS,
  );
  assert.equal(achievedFalse.objective_achieved, false);

  const achievedUnknown = mapConversationOutcomeToMcpFields(
    baseOutcome({ connected: false, achieved: null, neverConnectedReason: "busy" }),
    baseCall(),
    TEXTS,
  );
  assert.equal(
    achievedUnknown.objective_achieved,
    "unclear",
    "unbekannt (null) wird zu 'unclear', NICHT zu false",
  );
  assert.notEqual(
    achievedUnknown.objective_achieved,
    false,
    "unbekannt ist ausdruecklich NICHT nicht-erreicht",
  );
});

test("gepinnt: failure_reason kommt aus dem Nie-verbunden-Signal, im Vokabular aus failure-reason.js", () => {
  const connected = mapConversationOutcomeToMcpFields(
    baseOutcome({ connected: true }),
    baseCall(),
    TEXTS,
  );
  assert.equal(connected.failure_reason, null, "verbunden -> kein Fehlergrund");

  for (const reason of ["no-answer", "busy", "canceled"]) {
    const mapped = mapConversationOutcomeToMcpFields(
      baseOutcome({ connected: false, achieved: null, neverConnectedReason: reason }),
      baseCall(),
      TEXTS,
    );
    assert.equal(mapped.failure_reason, reason, `bekanntes Token ${reason} bleibt unveraendert`);
  }
});

test("gepinnt: eine rohe Anbieter-Kennung darf nicht nach aussen dringen", () => {
  const rawDetail = "sip-cause-9876-herstellerspezifisch";
  const rawReason = `failed:${rawDetail}`;
  const outcome = baseOutcome({ connected: false, achieved: null, neverConnectedReason: rawReason });
  const mapped = mapConversationOutcomeToMcpFields(outcome, baseCall(), TEXTS);

  assert.equal(mapped.failure_reason, failureReasonBase(rawReason), "gekappt auf den Basis-Token");
  assert.equal(mapped.failure_reason, "failed", "der Detail-Anhang faellt komplett weg");
  assert.notEqual(mapped.failure_reason, rawReason, "die rohe Kennung bleibt NICHT im Feld stehen");
  assert.ok(
    !JSON.stringify(mapped).includes(rawDetail),
    "die rohe Kennung dringt in KEINEM Feld des Ergebnisses nach aussen",
  );
});

test("gepinnt: outcome kommt aus summarizeCall (call.result.outcome), NICHT aus der Anbieter-Zusammenfassung", () => {
  const call = baseCall({ result: { outcome: "Eigene Karte: Termin Samstag 10 Uhr." } });
  const outcome = baseOutcome({ summary: "Anbieter-Text: Anruf abgeschlossen." });
  const mapped = mapConversationOutcomeToMcpFields(outcome, call, TEXTS);

  assert.equal(mapped.outcome, call.result.outcome, "outcome stammt aus der eigenen Ergebniskarte");
  assert.notEqual(
    mapped.outcome,
    outcome.summary,
    "die Anbieter-Zusammenfassung ueberschreibt outcome nicht",
  );
  assert.equal(
    mapped.result_summary,
    outcome.summary,
    "result_summary bleibt der getrennte Anbieter-Text",
  );
});

test("gepinnt: outcome ist null, wenn summarizeCall (noch) keine eigene Karte geschrieben hat", () => {
  const call = baseCall({ result: null });
  const mapped = mapConversationOutcomeToMcpFields(baseOutcome(), call, TEXTS);
  assert.equal(mapped.outcome, null);
});

test("gepinnt: duration_s kommt unveraendert aus den eigenen Zeitstempeln, nie vom Laufwerk", () => {
  const call = baseCall({ startedAt: STARTED_AT, endedAt: ENDED_AT });
  const expectedDurationS = Math.round((new Date(ENDED_AT) - new Date(STARTED_AT)) / MS_PER_SECOND);
  // Das Laufwerk schickt (vertragswidrig) eine eigene Dauer mit - sie darf NICHT gelesen
  // werden (defensiver Beleg, dass duration_s ausschliesslich aus call.* kommt).
  const outcome = baseOutcome({ duration_s: BOGUS_PROVIDER_DURATION_S, durationS: BOGUS_PROVIDER_DURATION_S });
  const mapped = mapConversationOutcomeToMcpFields(outcome, call, TEXTS);

  assert.equal(mapped.duration_s, expectedDurationS, "Dauer stammt aus call.startedAt/endedAt");
});
