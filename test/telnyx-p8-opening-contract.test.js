// stab-p8 Contract-Test (R5, Regel 2): der Assistant-Pfad-Erst-Speak (onAnswered) spricht
// den vollen openingText (Offenlegung + Anliegens-Bruecke). Nagelt fest: (a) bei gesetztem
// call.goal wird das Anliegen VOR ai_assistant_start gesprochen; (b) Regel 2 - Offenlegung
// byte-identisch erster Satz bei goal-gesetzt UND goal-leer; (c) goal-leer -> Speak-Text
// byte-identisch zum Status quo (== disclosureSentence). ECHTE openingText/disclosureSentence
// (seeded DATA_DIR, Muster g2-opening-turn), NICHT Fakes - sonst bewiese der Test nur die
// Verdrahtung, nicht die Regel-2-Invariante.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeCallControlIngest } from "../src/telnyx-call-control-ingest.js";
import { ingestTimeoutDeps } from "./telnyx-shim-harness.js";

let openingText, disclosureSentence, localeFor;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({ calls: [] }));
  ({ openingText, disclosureSentence } = await import("../src/claude.js"));
  ({ localeFor } = await import("../src/i18n/locales.js"));
});

// Minimaler Antrieb: onAnswered braucht nur store.getCall/markAnswered + voiceControl.speak.
// (Kein Nachbau der vollen Fake-Suite aus telnyx-event-ingest-machine.test.js - dieser Test
//  hat einen anderen Fokus: reale openingText-Ausgabe am Speak-Node, nicht Maschinen-Ordering.)
async function driveAnswered(call) {
  const speakCalls = [];
  // G5-TEST-DUP (Review-Blocker Runde 4): dieselbe config+Fake-Timer-Kombination wie
  // telnyx-event-ingest-machine.test.js/telnyx-stab-p9-watchdog.test.js - zentral aus
  // ingestTimeoutDeps() statt ein drittes Mal von Hand nachgebaut (armierter
  // Opening-Speak-Timer bleibt Fake, nie gefeuert).
  const handler = makeCallControlIngest({
    store: { getCall: (id) => (id === call.id ? call : null), markAnswered() {} },
    voiceControl: () => ({
      async speak(p) {
        speakCalls.push(p);
      },
      async startAssistant() {},
    }),
    finishCall: async () => {},
    openingText, // <-- ECHTE Funktion (neuer DI-Name, Edit 1)
    localeFor,
    ...ingestTimeoutDeps(),
  });
  const body = { data: { event_type: "call.answered", payload: { call_control_id: "cc_1" } } };
  await handler({ query: { callId: call.id }, body }, { sendStatus() {} });
  return speakCalls[0];
}

const outboundCall = (goal) => ({
  id: "call_p8",
  status: "active",
  provider: "telnyx",
  direction: "outbound",
  language: "de",
  tenantId: BOOTSTRAP_TENANT_ID,
  goal,
});

test("stab-p8: goal gesetzt -> onAnswered spricht Offenlegung + Anliegen (openingText)", async () => {
  const call = outboundCall("einen Friseurtermin zu vereinbaren");
  const speak = await driveAnswered(call);
  assert.equal(speak.text, openingText(call), "Speak-Node == openingText(call) (eine Quelle wie Budget-Pfad)");
  assert.ok(speak.text.startsWith(disclosureSentence(call)), "Regel 2: Offenlegung ist der erste Satz");
  assert.notEqual(speak.text, disclosureSentence(call), "Anliegens-Bruecke muss vorhanden sein");
  assert.match(speak.text, /Friseurtermin/, "das Anliegen wird tatsaechlich gesprochen (VOR ai_assistant_start)");
});

test("stab-p8 (Regel 2): Offenlegung byte-identisch erster Satz - goal-gesetzt UND goal-leer", async () => {
  const withGoal = await driveAnswered(outboundCall("einen Friseurtermin zu vereinbaren"));
  const emptyGoal = await driveAnswered(outboundCall(""));
  assert.ok(withGoal.text.startsWith(disclosureSentence(outboundCall("x"))));
  assert.ok(emptyGoal.text.startsWith(disclosureSentence(outboundCall(""))));
});

test("stab-p8: leeres goal -> Speak-Text byte-identisch zum Status quo (== disclosureSentence)", async () => {
  const call = outboundCall("");
  const speak = await driveAnswered(call);
  assert.equal(speak.text, disclosureSentence(call), "leeres Anliegen: reine Offenlegung wie vor stab-p8");
});
