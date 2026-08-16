// ---- Teil 2 (Owner-Auftrag 15.08.2026, Phase 2, woertlich: "Die Aufzeichnungen werden
// Fixtures. Attrappen antworten ab jetzt mit aufgezeichneten echten Antworten statt mit
// lokalen Konstanten.") ------------------------------------------------------------------
// Faehrt die drei Gespraechs-Datensaetze aus test/fixtures/elevenlabs-conversations.js
// (ECHTE, gegen api.elevenlabs.io gemessene Antworten, Herkunft dort je Fund dokumentiert)
// durch denselben Weg wie ein echter Poll-Takt (makeElevenLabsOutbound#
// rearmActiveConversationPolls -> pollConversationResult -> finishFromConversation), OHNE
// Netz/Server (Attrappen-fetch, Muster test/el-beende-versuch.test.js).
//
// EHRLICHKEIT (Pflicht b): der FAILED-Fund unten ist ein SIP-404 "ungueltiges Ziel", NICHT
// "niemand hat abgenommen" - dieser Fall ist NICHT belegt und wird hier auch nicht
// behauptet. Der CLOSE-1008-Fund traegt zwei Felder, die fuer GENAU DIESE Kennung nicht
// gemessen wurden (status, analysis) - als AUSGEDACHT gekennzeichnet, s. Fixture-Kommentar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import {
  CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES,
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_FAILED_INVALID_DESTINATION,
} from "./fixtures/elevenlabs-conversations.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const HTTP_OK = 200;
const WAIT_TIMEOUT_MS = 500;
const WAIT_POLL_INTERVAL_MS = 5;

async function withFetch(fetchImpl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

async function waitUntil(predicate, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Bedingung nicht innerhalb der Testfrist erreicht");
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_INTERVAL_MS));
  }
}

// Faengt genau die Werte ab, die persistProviderResult/applyAnsweredAnchor an den Store
// weiterreichen - dieselben Felder, die get_transcript und die Kostendecke lesen. Der Call
// entsteht HIER (statt als Parameter uebergeben zu werden) - sonst waere das Mutieren
// seiner Felder im endCallRecord-Fake unten ein no-param-reassign-Verstoss (P6/F2).
function makeCapturingStore({ id, elevenlabsConversationId, answeredAt }) {
  const call = {
    id,
    status: "active",
    elevenlabsConversationId,
    answeredAt,
    startedAt: answeredAt,
    endedAt: null,
  };
  const captured = { transcript: [], summary: undefined, objectiveAchieved: undefined, answeredAtIso: undefined, unclearReasons: [] };
  const store = {
    getCall: () => call,
    load: () => ({ calls: [call] }),
    addTranscript: (_id, role, message) => captured.transcript.push({ role, message }),
    recordProviderCallResult: (_id, { summary, objectiveAchieved }) => {
      captured.summary = summary;
      captured.objectiveAchieved = objectiveAchieved;
    },
    // ABNAHME-D1: additiv NEBEN recordProviderCallResult (persistProviderResult, s.
    // src/elevenlabs/outbound.js) - keine der drei Fixtures dieser Datei traegt
    // data_collection_results, deshalb hier reine No-ops statt eigener Erfassung
    // (die eigene Erfassung deckt test/elevenlabs-data-collection.test.js ab).
    recordProviderCollectedFields: () => {},
    recordCalleeConfirmedTimezone: () => {},
    trueUpAnsweredAt: (_id, answeredAtIso) => {
      captured.answeredAtIso = answeredAtIso;
    },
    recordAnsweredUnclearReason: (_id, reason) => captured.unclearReasons.push(reason),
    // Der ECHTE Store (endCallRecord) liefert den fertig persistierten Call zurueck -
    // answeredAnchorOutcome braucht dessen endedAt (s. outbound.js#finishFromConversation).
    endCallRecord: (_id, status) => {
      call.status = status;
      call.endedAt = new Date().toISOString();
      return call;
    },
  };
  return { call, store, captured };
}

// EIN Poll-Takt gegen EINEN Gespraechs-Datensatz (Fixture) - der Anbieter antwortet sofort
// mit dem uebergebenen Datensatz, egal welche Kennung angefragt wird (jeder Test hier
// fragt genau eine Kennung ab).
async function pollFixtureConversation(fixture) {
  const { call, store, captured } = makeCapturingStore({
    id: `call_${fixture.conversation_id}`,
    elevenlabsConversationId: fixture.conversation_id,
    answeredAt: new Date().toISOString(),
  });
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: ACCOUNT }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });
  await withFetch(
    async (_url, init) =>
      init.method === "GET" ? { ok: true, status: HTTP_OK, json: async () => fixture } : { ok: true, status: HTTP_OK },
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );
  return { call, captured };
}

// ---- FAILED: SIP 404 "Invalid destination number" -------------------------------------
test("Fixture FAILED (SIP-404 ungueltiges Ziel): analysis:null ueberlebt, KEIN Buchungsanker, KEINE Behauptung ueber 'niemand hat abgenommen'", async () => {
  const { call, captured } = await pollFixtureConversation(CONVERSATION_FAILED_INVALID_DESTINATION);

  assert.equal(call.status, "failed", "Anbieter-Status 'failed' -> unser Status 'failed'");
  assert.deepEqual(captured.transcript, [], "kein gesprochener Inhalt (agent kam nie zu Wort)");
  assert.equal(captured.summary, null, "analysis:null -> keine Zusammenfassung, kein Wurf (Pflicht d)");
  assert.equal(
    captured.objectiveAchieved,
    "unclear",
    "analysis:null -> objectiveAchievedOf faellt auf 'unclear' zurueck, statt zu werfen (Pflicht d)",
  );
  // call_duration_secs ist GEMESSEN 0 (nicht fehlend/NaN) - das ist der bekannte Fall
  // "kein Anker, kein Grund" (KS-EL1), NICHT der unklare Fall. Ein 0-Sekunden-Anruf, bei
  // dem der Ziel-SIP-404 VOR jeder Rufannahme kam, darf nicht wie eine unklare Antwort des
  // Anbieters behandelt werden - er IST bekannt: es wurde nie abgenommen.
  assert.equal(captured.answeredAtIso, null, "call_duration_secs=0 -> kein Buchungsanker");
  assert.deepEqual(
    captured.unclearReasons,
    [],
    "0 ist der BEKANNTE Fall (niemand hat abgenommen) - kein unclearReason, anders als fehlend/NaN",
  );
});

// UNABHAENGIG von der Fixture abgetippt (nicht per Referenz auf CONVERSATION_DONE_
// WITH_ANALYSIS.analysis.transcript_summary verglichen) - sonst wuerde eine verfaelschte
// Fixture den Vergleich NICHT rot faerben, weil beide Seiten der Assertion identisch
// mitverfaelscht wuerden (ROTPROBE 2 deckte genau das auf, s. Ruecksprache im Report).
const ERWARTETE_ZUSAMMENFASSUNG =
  'The AI assistant conducted a test call for Jonas Beispiel. The user provided feedback, noting clear audio but slightly off quality, slow pace, and an "American" sounding voice. The user also asked if the AI could perform internet lookups (e.g., weather), to which the AI replied it currently lacks browsing capabilities, its role being limited to the test. The user considered the test a success, finding this version an improvement over the live one, specifically praising the ability to converse indefinitely without interruption. Future enhancements, such as internet browsing tools, were suggested for upcoming tests.';

// ---- DONE: ein technisch gelungenes, inhaltlich erfolgloses Gespraech (149s) -----------
test("Fixture DONE (149s, call_successful:failure): Transkript+Zusammenfassung kommen WOERTLICH (maskiert) an, Buchungsanker aus echter Dauer", async () => {
  const { call, captured } = await pollFixtureConversation(CONVERSATION_DONE_WITH_ANALYSIS);

  assert.equal(call.status, "completed", "Anbieter-Status 'done' -> unser Status 'completed'");
  assert.deepEqual(
    captured.transcript,
    [
      {
        role: "agent",
        message:
          "Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent.",
      },
      // Der Anbieter nennt die Gegenseite "user", unser Transkript "caller" (roleOf,
      // outbound.js) - der WORTLAUT bleibt unveraendert, nur die Rollen-Bezeichnung wird
      // uebersetzt.
      { role: "caller", message: "Okay, cool. What do you want?" },
    ],
    "die ECHTEN (maskierten) Transkriptzeilen kommen woertlich am Store an, Rolle uebersetzt",
  );
  assert.equal(captured.summary, ERWARTETE_ZUSAMMENFASSUNG, "die ECHTE Anbieter-Zusammenfassung kommt woertlich an");
  assert.equal(
    captured.objectiveAchieved,
    false,
    "call_successful:'failure' -> objectiveAchieved false (der Anbieter bewertet das AUFTRAGSZIEL, nicht ob das Telefonat gelang)",
  );
  assert.ok(captured.answeredAtIso, "call_duration_secs=149 (positiv) -> ein echter Buchungsanker wird gesetzt");
  assert.equal(
    new Date(call.endedAt).getTime() - new Date(captured.answeredAtIso).getTime(),
    CONVERSATION_DONE_WITH_ANALYSIS.metadata.call_duration_secs * MS_PER_SECOND,
    "der Anker liegt exakt call_duration_secs vor dem Gespraechsende",
  );
  assert.deepEqual(captured.unclearReasons, [], "ein brauchbarer Anker braucht keinen Unklar-Grund");
});

// ---- CLOSE-1008: sofortiger WebSocket-Abbruch mangels dynamischer Variable -------------
test("Fixture CLOSE-1008 (fehlende dynamische Variable): winziger, aber ECHTER Anker (1s) - kein leerer Wert trotz leerem Transkript", async () => {
  const { call, captured } = await pollFixtureConversation(CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES);

  // status ist fuer DIESE Kennung nicht gemessen (Fixture-Kommentar, AUSGEDACHT) - der Test
  // pinnt trotzdem das VERHALTEN fuer den Wert, den die Fixture traegt ("done").
  assert.equal(call.status, "completed");
  assert.deepEqual(captured.transcript, [], "agent_redet:false (gemessen) - kein gesprochener Inhalt");
  assert.equal(captured.summary, null, "analysis:null (plausibel abgeleitet) -> keine Zusammenfassung");
  assert.equal(captured.objectiveAchieved, "unclear");
  // call_duration_secs=1 ist GEMESSEN und POSITIV - anders als der FAILED-Fund oben (0)
  // ist das hier kein "niemand hat abgenommen": die Leitung stand kurz, der Agent kam nur
  // nie zu Wort. Ein Anker MUSS gesetzt werden, sonst wuerde ein winziges echtes Gespraech
  // wie eine unbeantwortete Klingel aussehen.
  assert.ok(captured.answeredAtIso, "eine positive (wenn auch winzige) Dauer ergibt einen echten Anker, keinen Nullwert");
  assert.equal(
    new Date(call.endedAt).getTime() - new Date(captured.answeredAtIso).getTime(),
    CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES.metadata.call_duration_secs * MS_PER_SECOND,
  );
  assert.deepEqual(captured.unclearReasons, []);
});
