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
// Ergebnis - Datum, Uhrzeit, Preis, "Ziel erreicht", am ECHTEN Weg gemessen.
//
// FRUEHER STANDEN HIER DREI WEITERE TESTS, die dasselbe ueber eine generische Abbildung
// "Gespraechsergebnis -> MCP-Felder" (src/conversation/outcome-to-mcp-fields.js) gegen die
// Attrappe test/fixtures/mock-conversation-driver.js prueften. Diese Abbildung war an
// KEINEN echten Gespraechsfuehrungs-Adapter angeschlossen - sie hatte in src/ keinen
// einzigen Aufrufer - und ist am 17.08.2026 samt ihrer Tests geloescht worden (Phase 5,
// tote Exporte). Die drei Faelle belegten deshalb ohnehin nichts ueber den Weg, auf dem
// ein echtes Gespraech ankommt; sie sagten das selbst ("Dieser Fall belegt NICHT, dass der
// Weg schon steht"). Was bleibt, ist der Test, der GENAU DIESEN echten Weg misst.
//
// DER VERBLIEBENE TEST (ABGENOMMEN D1) prueft den Weg, ueber den ein echtes Gespraech
// tatsaechlich bei uns ankommt: src/elevenlabs/outbound.js
// (ziehender Ergebnisabruf, GET /v1/convai/conversations/{id}). D1 prueft deshalb GENAU
// DIESEN echten Weg: die Anbieter-Antwort fuehrt data_collection_results (vom Agenten
// waehrend des Gespraechs STRUKTURIERT gesammelt, deklariert in elevenlabs/agent_configs/
// outbound-agent.template.json), src/elevenlabs/outbound.js liest sie
// (collectedFieldsOf/persistProviderResult) und src/store/state-ops.js speichert sie
// additiv am Anruf-Datensatz (recordProviderCollectedFields). Das exponierende MCP-Schema
// (src/mcp-tools.js: pickTranscript/get_call_result) bleibt in diesem Paket bewusst
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
import { waitUntil } from "./conversation-driver-contract.js";
// [abgenommen D1]: der echte Weg, ueber den die vier Angaben ankommen (s. Datei-Kopf).
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { withFetch } from "./helpers.js";
import { CONVERSATION_DONE_WITH_DATA_COLLECTION } from "./fixtures/elevenlabs-conversations.js";

// Die drei ausgehandelten Werte des Gespraechs - je EINE Konstante, damit Fixture,
// Erwartung und Fehlermeldung nie auseinanderlaufen.
const APPOINTMENT_DATE = "March 3";
const APPOINTMENT_TIME = "2:30 PM";

// Jeder Wert, den ein Auftraggeber im Ergebnis als EIGENE Angabe vorfindet - Feldwerte
// und Eintraege von Listenfeldern. Bewusst OHNE Teilstring-Suche: ein Wert, der nur
// irgendwo in einem Satz steckt, ist keine Angabe, die eine Maschine lesen kann.
function ownValuesOf(mapped) {
  return Object.values(mapped).flatMap((value) => (Array.isArray(value) ? value : [value]));
}

// [abgenommen D1] fuehrt den ECHTEN Ergebnisweg (s. Datei-Kopf), keine Mock-Attrappe: der
// Anbieter (ElevenLabs) fuehrt das Gespraech und meldet am Ende data_collection_results
// (GET /v1/convai/conversations/{id}) - der Anbieter selbst wird per Attrappen-fetch
// ersetzt (Muster test/el-fixtures-echte-antworten.test.js), aber src/elevenlabs/
// outbound.js (Lesen+Speichern) laeuft UNVERAENDERT und echt.
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
    // Join-Schluessel zur Telefonie-Rechnung (persistProviderResult, s.
    // src/elevenlabs/outbound.js): hier ein No-op - der Sachverhalt dieser Datei
    // haengt nicht an ihm, aber die Attrappe muss die Methode kennen, sonst wirft
    // der Ergebnisweg einen TypeError.
    recordSipCallId: () => {},
    // ST3: Zaehlfeld der Stimmen-Detektoren - dieselbe Begruendung wie recordSipCallId
    // direkt darueber.
    recordElDetectorCounts: () => {},
    // OUTBOUND-E5: dieselbe Begruendung wie recordSipCallId direkt darueber.
    recordFromRegistrationSource: () => {},
    recordActualSender: () => {},
    trueUpAnsweredAt: () => {},
    recordAnsweredUnclearReason: () => {},
    // OUTBOUND-E2: finishFromConversation ruft recordFailureReason UNBEDINGT - eine
    // unvollstaendige Attrappe soll auffallen (TypeError), nicht stumm bleiben.
    recordFailureReason: () => {},
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
