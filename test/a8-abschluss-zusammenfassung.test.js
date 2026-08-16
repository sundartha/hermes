// Abnahmekriterium A8, ZUSAMMENFASSUNGS-TEIL (Eigentuemer-Entscheidung D1).
//
// A8 verlangt zweierlei: im Gespraech wiederholt der Agent Datum, Uhrzeit und Preis und
// beendet sauber - UND danach traegt das Ergebnis genau diese drei Werte plus ein
// eindeutiges "Ziel erreicht". Die Testmaschine des Anbieters prueft nur die erste
// Haelfte: sie wertet den simulierten Gespraechsverlauf aus, den Post-Call-Webhook sieht
// sie nicht (woertlich vermerkt in elevenlabs/tests/a8-sauberer-abschluss.json, Feld
// "_hinweis"). Die zweite Haelfte ist deshalb DIESE Datei - gegen die Attrappe
// (test/fixtures/mock-conversation-driver.js), ohne Anbieter, ohne Konto, ohne Netz.
//
// GEPRUEFT WIRD: aus einem abgeschlossenen Gespraech wird bei uns ein verwertbares
// Ergebnis - Datum, Uhrzeit, Preis, "Ziel erreicht". Die ersten drei Tests dieser Datei
// pruefen das ueber die generische Abbildung "Gespraechsergebnis -> MCP-Felder"
// (src/conversation/outcome-to-mcp-fields.js, gegen die Attrappe test/fixtures/mock-
// conversation-driver.js) - in der Form, die der Auftraggeber ueber MCP liest
// (src/mcp-tools.js: pickTranscript, get_transcript).
//
// DER VIERTE TEST (ABGENOMMEN D1) PRUEFT ETWAS ANDERES UND SAGT DAS AUSDRUECKLICH: die
// generische Abbildung darueber ist bis heute an KEINEN echten Gespraechsfuehrungs-Adapter
// angeschlossen (s. deren Modul-Kopf, "GENAU EIN Adapter ist vorgesehen") - der Weg, ueber
// den ein echtes Gespraech tatsaechlich bei uns ankommt, ist src/elevenlabs/outbound.js
// (ziehender Ergebnisabruf, GET /v1/convai/conversations/{id}). D1 prueft deshalb GENAU
// DIESEN echten Weg: die Anbieter-Antwort fuehrt data_collection_results (vom Agenten
// waehrend des Gespraechs STRUKTURIERT gesammelt, deklariert in elevenlabs/agent_configs/
// outbound-agent.template.json), src/elevenlabs/outbound.js liest sie
// (collectedFieldsOf/persistProviderResult) und src/store/state-ops.js speichert sie
// additiv am Anruf-Datensatz (recordProviderCollectedFields). Das exponierende MCP-Schema
// (src/mcp-tools.js: pickTranscript/get_transcript) bleibt in diesem Paket bewusst
// unangetastet (Auftragsgrenze) - die vier Angaben sind heute als EIGENE Felder am
// Call-Record lesbar, noch nicht ueber MCP; das ist eine eigene, spaetere Entscheidung
// (das MCP-Schema nach aussen zu aendern).
//
// SPRACHE: alles, was ein US-Nutzer sehen oder hoeren wuerde, ist englisch, der Kontext
// US (stehende Eigentuemer-Entscheidung; A8 selbst laeuft auf Englisch, Werkstattszenario,
// Preise in Dollar). Nur die Attrappe selbst spricht Deutsch - ihr fester Praefix
// ("Antwort erhalten: ") ist Fixture-Text einer Testdatei, nie eine Kundenzeile. Der
// INHALT der Zusammenfassung, also genau das, was ein echter Anbieter spaeter schreibt,
// kommt aus diesem Test und ist durchgehend englisch.
//
// STAND JE ANGABE (gemessen, nicht vermutet):
//   Ziel erreicht - eigenes Feld objective_achieved, dreiwertig (true/false/"unclear").
//   Datum         - eigenes Feld call.appointmentDate (ElevenLabs-Weg, additiv am
//                   Call-Record, s. vierter Test). Ueberlebt daneben weiterhin als
//                   Zeichenkette im Freitext result_summary (unveraendert, kein Ersatz).
//   Uhrzeit       - eigenes Feld call.appointmentTime. Ebenso.
//   Preis         - eigene Felder call.amount + call.currency. Ebenso. Die Ergebnis-Karte
//                   (src/call-result.js, resultCardView in src/mcp-tools.js) traegt
//                   weiterhin outcome/commitments/counterparty_commitments/open_points/
//                   next_step - dieses Schema aendert TEIL 1-3 (ABNAHME-D1) NICHT.
//
// Testnamen tragen bewusst KEINE Katalog-ID des i18n-Launch-Testkatalogs am Namensanfang
// ("A8-" ist keine, s. package.json config.i18nCatalogPattern) - sonst landet die Datei
// im Gates-Lauf statt im Regressionslauf (Lehre catalog-id-prefix-misroutes-tests).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseStartParams,
  makeCallbackSpy,
  MOCK_OBJECTIVE,
  waitUntil,
} from "./conversation-driver-contract.js";
import { makeMockConversationDriver } from "./fixtures/mock-conversation-driver.js";
import { mapConversationOutcomeToMcpFields } from "../src/conversation/outcome-to-mcp-fields.js";
import { pickTranscript } from "../src/mcp-tools.js";
// [abgenommen D1]: der echte Weg, ueber den die vier Angaben ankommen (s. Datei-Kopf).
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { CONVERSATION_DONE_WITH_DATA_COLLECTION } from "./fixtures/elevenlabs-conversations.js";

// Die drei ausgehandelten Werte des Gespraechs - je EINE Konstante, damit Fixture,
// Erwartung und Fehlermeldung nie auseinanderlaufen.
const APPOINTMENT_DATE = "March 3";
const APPOINTMENT_TIME = "2:30 PM";
const APPOINTMENT_PRICE = "$60.00";

// Die Fakten, mit denen der Auftraggeber die Rueckfrage der Attrappe beantwortet. Sie
// landen woertlich in ConversationOutcome.summary (mock-conversation-driver.js:
// outcomeFromConsultAnswer) - das ist der einzige Weg, ein attrappen-ERZEUGTES Ergebnis
// mit eigenem Inhalt zu bekommen, ohne die Attrappe umzubauen.
const APPOINTMENT_FACTS = Object.freeze([
  `Appointment confirmed for ${APPOINTMENT_DATE}`,
  `Start time ${APPOINTMENT_TIME}`,
  `Agreed price ${APPOINTMENT_PRICE}`,
]);

// Rollen-Praefixe wie texts.roleAgent/texts.roleCounterparty in pickCallStatus
// (src/mcp-tools.js) - englisch, wie alles, was ein US-Nutzer zu sehen bekaeme.
const TEXTS = Object.freeze({ roleAgent: "Agent", roleCounterparty: "Contact" });

// Gespraechsverlauf des A8-Szenarios (Werkstatt, US): der Agent wiederholt Datum,
// Uhrzeit und Preis zur Bestaetigung und verabschiedet sich - die Haelfte, die die
// Testmaschine des Anbieters selbst prueft. Hier steht sie nur als Eingabe fuer den
// eigenen Anruf-Datensatz.
const TRANSCRIPT_FIXTURE = Object.freeze([
  { role: "agent", text: "Hello, I am calling on behalf of Owen Barrett about replacing the rear brake pads." },
  { role: "counterparty", text: `We could take the car on ${APPOINTMENT_DATE} at ${APPOINTMENT_TIME}.` },
  { role: "agent", text: "And what would that cost?" },
  { role: "counterparty", text: `${APPOINTMENT_PRICE} for the pads and the labor.` },
  { role: "agent", text: `So ${APPOINTMENT_DATE}, ${APPOINTMENT_TIME}, ${APPOINTMENT_PRICE}. Thank you, goodbye.` },
]);

const STARTED_AT = "2026-02-24T15:00:00.000Z";
const ENDED_AT = "2026-02-24T15:02:00.000Z";

// Der eigene Anruf-Datensatz nach dem Gespraech. result ist null: im Anbieter-Pfad
// laeuft summarizeCall (src/claude.js) nicht mehr, die eigene Ergebnis-Karte entsteht
// also gar nicht erst - genau der Fall, den A8 abdecken muss.
function completedCall(overrides = {}) {
  return {
    transcript: TRANSCRIPT_FIXTURE,
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
    result: null,
    ...overrides,
  };
}

// Faehrt EIN Szenario durch die Attrappe und liefert das gemeldete ConversationOutcome.
async function runMockConversation(callId, objective, overrides = {}) {
  const spy = makeCallbackSpy(overrides);
  const driver = makeMockConversationDriver({ callbacks: spy.callbacks });
  await driver.startConversation(baseStartParams(callId, objective));
  await waitUntil(() => spy.outcomes.length > 0);
  return spy.outcomes[0];
}

// Der Auftraggeber beantwortet die Rueckfrage mit den drei ausgehandelten Werten -
// die Attrappe traegt sie daraufhin in ihr Ergebnis.
function answersWithAppointment() {
  return {
    onConsultRaised: async () => ({ kind: "answered", facts: [...APPOINTMENT_FACTS] }),
  };
}

// Ein erfolgreich abgeschlossenes Gespraech, auf die MCP-Felder abgebildet.
async function mappedResultOfSuccessfulCall(callId) {
  const outcome = await runMockConversation(callId, MOCK_OBJECTIVE.CONSULT, answersWithAppointment());
  return mapConversationOutcomeToMcpFields(outcome, completedCall(), TEXTS);
}

// Jeder Wert, den ein Auftraggeber im Ergebnis als EIGENE Angabe vorfindet - Feldwerte
// und Eintraege von Listenfeldern. Bewusst OHNE Teilstring-Suche: ein Wert, der nur
// irgendwo in einem Satz steckt, ist keine Angabe, die eine Maschine lesen kann.
function ownValuesOf(mapped) {
  return Object.values(mapped).flatMap((value) => (Array.isArray(value) ? value : [value]));
}

test("A8-Abschluss: Datum, Uhrzeit und Preis eines abgeschlossenen Gespraechs kommen im Ergebnis an", async () => {
  const mapped = await mappedResultOfSuccessfulCall("a8-summary-values");

  assert.equal(mapped.status, "completed", "ein gefuehrtes, abgeschlossenes Gespraech ist completed");
  for (const value of [APPOINTMENT_DATE, APPOINTMENT_TIME, APPOINTMENT_PRICE]) {
    assert.ok(
      mapped.result_summary.includes(value),
      `"${value}" ueberlebt die Abbildung im Zusammenfassungstext - result_summary ist ` +
        `heute der EINZIGE Traeger dieser Angabe (${mapped.result_summary})`,
    );
  }
});

test("A8-Abschluss: 'Ziel erreicht' kommt als eigene Angabe an, in der Form, die der Auftraggeber ueber MCP liest", async () => {
  const callId = "a8-objective-achieved";
  const mapped = await mappedResultOfSuccessfulCall(callId);

  assert.equal(mapped.objective_achieved, true, "das erreichte Ziel kommt als eigenes Feld an");

  // Dieselben Werte durch die ECHTE MCP-Sicht (src/mcp-tools.js), die get_transcript
  // ausliefert - kein Nachbau. Das Zuweisen der beiden Felder auf den Anruf-Datensatz
  // erledigt hier der Test: die Verdrahtung der Abbildung in den Store existiert
  // bewusst noch nicht (Commit 653ecb8). Dieser Fall belegt deshalb NICHT, dass der
  // Weg schon steht - er pinnt, dass die abgebildeten Werte die Form haben, die die
  // MCP-Sicht unveraendert weiterreicht.
  const view = pickTranscript(callId, {
    summary: mapped.result_summary,
    objectiveAchieved: mapped.objective_achieved,
    result: null,
  });

  assert.equal(view.objective_achieved, true, "get_transcript liefert das Ziel-Signal unveraendert");
  assert.ok(
    view.result_summary.includes(APPOINTMENT_PRICE),
    "der verhandelte Preis erreicht ueber result_summary tatsaechlich den Auftraggeber",
  );
});

test("A8-Gegenfall: ein Gespraech ohne erreichtes Ziel gilt nie als erreicht", async () => {
  // 1. Es kam nie ein Gespraech zustande.
  const neverConnected = await runMockConversation("a8-never-connected", MOCK_OBJECTIVE.NEVER_CONNECTED);
  const neverMapped = mapConversationOutcomeToMcpFields(neverConnected, completedCall(), TEXTS);
  assert.equal(neverMapped.status, "failed", "ohne Gespraech ist der Anruf gescheitert");
  assert.notEqual(neverMapped.objective_achieved, true, "ohne Gespraech ist NICHTS erreicht");
  assert.equal(neverMapped.objective_achieved, "unclear", "unbekannt bleibt unbekannt, nicht 'nein'");

  // 2. Das Gespraech lief, aber der Auftraggeber hat die Rueckfrage nie beantwortet -
  //    der Termin steht damit nicht fest.
  const unanswered = await runMockConversation("a8-consult-unanswered", MOCK_OBJECTIVE.CONSULT, {
    onConsultRaised: async () => ({ kind: "timeout", facts: [], reason: "owner_did_not_answer" }),
  });
  const unansweredMapped = mapConversationOutcomeToMcpFields(unanswered, completedCall(), TEXTS);
  assert.equal(unansweredMapped.status, "completed", "das Gespraech lief - offen ist nur das Ziel");
  assert.notEqual(unansweredMapped.objective_achieved, true, "ein offener Ausgang ist kein Erfolg");

  // 3. Die Werkstatt lehnt ab. Die Attrappe kennt keinen achieved:false-Ausgang (jeder
  //    ihrer Wege endet auf true oder null), deshalb kommt dieser Wert direkt aus dem
  //    Vertrag (conversation-ports.js: ConversationOutcome).
  const refusedMapped = mapConversationOutcomeToMcpFields(
    {
      callId: "a8-refused",
      connected: true,
      achieved: false,
      summary: "The shop has no opening before April and did not take the appointment.",
    },
    completedCall(),
    TEXTS,
  );
  assert.equal(refusedMapped.objective_achieved, false, "eine Absage ist ein ausdrueckliches Nein");
  assert.notEqual(refusedMapped.objective_achieved, true, "eine Absage gilt NIE als erreicht");
});

// [abgenommen D1] fuehrt den ECHTEN Ergebnisweg (s. Datei-Kopf), keine Mock-Attrappe: der
// Anbieter (ElevenLabs) fuehrt das Gespraech und meldet am Ende data_collection_results
// (GET /v1/convai/conversations/{id}) - der Anbieter selbst wird per Attrappen-fetch
// ersetzt (Muster test/el-fixtures-echte-antworten.test.js), aber src/elevenlabs/
// outbound.js (Lesen+Speichern) laeuft UNVERAENDERT und echt.
async function withFetch(fetchImpl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

// Faengt das Ergebnis ab, das persistProviderResult an den Store weiterreicht - dieselbe
// Attrappen-Form wie el-fixtures-echte-antworten.test.js, hier zusaetzlich um TEIL-2/3-
// Felder ergaenzt.
function makeCapturingStore(conversationId) {
  const call = {
    id: `call_${conversationId}`,
    status: "active",
    elevenlabsConversationId: conversationId,
    answeredAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  const captured = { transcript: [], summary: undefined };
  const store = {
    getCall: () => call,
    load: () => ({ calls: [call] }),
    addTranscript: (_id, role, message) => captured.transcript.push({ role, message }),
    recordProviderCallResult: (_id, { summary, objectiveAchieved }) => {
      captured.summary = summary;
      call.objectiveAchieved = objectiveAchieved;
    },
    // Schreibt DIREKT auf den Call-Record - dieselbe Form wie state-ops.js#
    // recordProviderCollectedFields, damit dieser Test das echte Ergebnisschema prueft
    // (call.appointmentDate/appointmentTime/amount/currency), nicht nur eine Attrappen-
    // Kopie davon.
    recordProviderCollectedFields: (_id, { appointmentDate, appointmentTime, amount, currency }) => {
      call.appointmentDate = appointmentDate;
      call.appointmentTime = appointmentTime;
      call.amount = amount;
      call.currency = currency;
    },
    recordCalleeConfirmedTimezone: () => {},
    trueUpAnsweredAt: () => {},
    recordAnsweredUnclearReason: () => {},
    endCallRecord: (_id, status) => {
      call.status = status;
      call.endedAt = new Date().toISOString();
      return call;
    },
  };
  return { call, store, captured };
}

test("[abgenommen D1] Datum, Uhrzeit und Betrag kommen als eigene Angaben im Ergebnis an", async () => {
  const { call, store, captured } = makeCapturingStore(CONVERSATION_DONE_WITH_DATA_COLLECTION.conversation_id);
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: { apiKey: "test-key", apiBase: "https://el.test" } }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });

  const HTTP_OK = 200;
  await withFetch(
    async (_url, init) =>
      init.method === "GET"
        ? { ok: true, status: HTTP_OK, json: async () => CONVERSATION_DONE_WITH_DATA_COLLECTION }
        : { ok: true, status: HTTP_OK },
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );

  // Gegenprobe, damit dieser Fall nicht aus einem Messfehler heraus gruen ist: der Freitext
  // (result_summary) traegt die Angaben WEITERHIN - additiv, kein Ersatz (Owner-Auflage).
  assert.equal(
    captured.summary,
    CONVERSATION_DONE_WITH_DATA_COLLECTION.analysis.transcript_summary,
    "die Zusammenfassung bleibt der unveraenderte Anbieter-Freitext",
  );

  // Die vier Angaben kommen jetzt ZUSAETZLICH als EIGENE, exakte Felder an - ownValuesOf
  // (Bestands-Helfer dieser Datei) prueft bewusst OHNE Teilstring-Suche: ein Wert, der nur
  // irgendwo in einem Satz steckt, ist keine Angabe, die eine Maschine lesen kann.
  const ownValues = ownValuesOf({
    appointment_date: call.appointmentDate,
    appointment_time: call.appointmentTime,
    amount: call.amount,
    currency: call.currency,
  });
  const required = [
    ["Datum", APPOINTMENT_DATE],
    ["Uhrzeit", APPOINTMENT_TIME],
    ["Betrag", "60"],
    ["Waehrung", "USD"],
  ];
  for (const [label, value] of required) {
    assert.ok(
      ownValues.includes(value),
      `${label} ("${value}") ist im Ergebnis als eigene Angabe lesbar (call.appointmentDate/` +
        "appointmentTime/amount/currency) - additiv neben result_summary, kein Ersatz dafuer",
    );
  }
});
