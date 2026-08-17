// Owner-Auftrag 15.08.2026 (Aufgabe 2): scheduleResultPoll (elevenlabs/outbound.js) ist ein
// reiner In-Prozess-setTimeout - sein EINZIGER Ausloeser ist originateCall. Ohne Boot-Re-Arm
// nimmt ein Neustart/Deploy die Poll-Schleife mit: ein aktiver EL-Call (elevenlabsConversationId
// gesetzt) bleibt fuer immer "active", Transkript/Zusammenfassung fallen aus. Belegt echt als
// Kindprozess (Muster telnyx-p6-boot-rearm.test.js): der Call wird DIREKT als aktiv geseedet
// (simulierter Neustart mit bereits laufendem Anruf), nicht ueber place_call erzeugt.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { seedCall, seedState, startServer, waitForStoreState } from "./helpers.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import {
  CONVERSATION_DONE_WITH_ANALYSIS,
  ERROR_ENVELOPES,
} from "./fixtures/elevenlabs-conversations.js";

const CONVERSATION_PATH = "/v1/convai/conversations/";
const HTTP_OK = 200;
const CALL_ID = "call_boot_rearm";

// Die Attrappe antwortet mit einer ECHTEN, gegen api.elevenlabs.io gemessenen Antwort
// (15.08.2026, s. test/fixtures/elevenlabs-conversations.js) statt mit lokal erfundenen
// Werten - Owner-Regel: keine erfundene Anbieter-Antwort, wo eine echte aufgezeichnet ist.
// Kennung und Zusammenfassung stammen aus DEMSELBEN Fund, damit die Attrappe genau das
// antwortet, wonach der Poll fragt.
const CONV_ID = CONVERSATION_DONE_WITH_ANALYSIS.conversation_id;
const PROVIDER_SUMMARY = CONVERSATION_DONE_WITH_ANALYSIS.analysis.transcript_summary;

// Die Ergebnis-Attrappe des Anbieters: EIN Endpunkt (GET) - der Anrufstart selbst wird hier
// nie durchlaufen (der Call ist bereits als aktiv geseedet), also braucht die Attrappe
// keinen POST-Zweig. Der Fehlbedien-Zweig antwortet mit dem GEMESSENEN 404-Umschlag des
// Anbieters. EHRLICHKEIT: gemessen ist dieser Umschlag fuer eine unbekannte
// Gespraechs-Kennung, NICHT fuer einen unbekannten Pfad - dafuer existiert keine
// Aufzeichnung. Er steht hier trotzdem, weil unser Code den Fehler-Rumpf nie liest
// (src/elevenlabs/convai.js: nur der Status zaehlt) und die echte Umschlag-Form allemal
// naeher an der Anbieter-Wahrheit liegt als ein erfundener deutscher Satz.
async function startResultMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url });
    if (!req.url.startsWith(CONVERSATION_PATH)) {
      res.writeHead(ERROR_ENVELOPES.notFound.httpStatus, { "content-type": "application/json" });
      return res.end(JSON.stringify(ERROR_ENVELOPES.notFound.body));
    }
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(CONVERSATION_DONE_WITH_ANALYSIS));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// answeredAt vor wenigen Sekunden, maxDurationS grosszuegig: WEDER diese Klassifikation
// (ELEVENLABS_PROVIDER_MAX_DURATION_S, pollConversationResult) NOCH der unabhaengige
// Platform-Max-Dauer-Cap (rearmActiveCallTimers, call-lifecycle.js - laeuft unveraendert
// fuer JEDEN aktiven Call mit) duerfen den Call waehrend der kurzen Testlaufzeit von sich
// aus terminalisieren - GENAU der Poll-Re-Arm soll den Ausschlag geben, kein Nachbar-Timer.
const ANSWERED_SECONDS_AGO = 5;
const ANSWERED_AT = new Date(Date.now() - ANSWERED_SECONDS_AGO * MS_PER_SECOND).toISOString();

function activeElCallSeed() {
  return seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        provider: "telnyx", // der Provider des Anrufs bleibt telnyx (s. outbound.js Modul-Kopf)
        status: "active",
        answeredAt: ANSWERED_AT,
        startedAt: ANSWERED_AT,
        maxDurationS: 3600,
        elevenlabsConversationId: CONV_ID,
      }),
    ],
  });
}

test("EL-BOOT-REARM: ein aktiver EL-Call mit conversation_id wird nach dem Boot fertiggestellt (Transkript+Zusammenfassung, Status verlaesst 'active')", async () => {
  const mock = await startResultMock();
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: mock.url, ELEVENLABS_API_KEY: "test-key" },
    seed: activeElCallSeed(),
  });
  try {
    const stand = await waitForStoreState(
      srv,
      (state) => state.calls.find((eintrag) => eintrag.id === CALL_ID)?.status !== "active",
    );
    const call = stand.calls.find((eintrag) => eintrag.id === CALL_ID);

    assert.ok(
      mock.requests.some((anfrage) => anfrage.url.includes(CONV_ID)),
      "der Anbieter wurde nach dem Boot ueberhaupt nach dem Ergebnis gefragt - ohne Re-Arm bleibt die Attrappe unberuehrt",
    );
    assert.notEqual(call.status, "active", "der Boot-Re-Arm muss den liegen gebliebenen Anruf terminalisieren");
    assert.equal(
      call.summary,
      PROVIDER_SUMMARY,
      "die ECHTE Zusammenfassung des Anbieters muss ankommen, nicht nur irgendein Status-Wechsel (Max-Dauer-Cap allein wuerde das NICHT liefern)",
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});
