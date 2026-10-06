import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const OFFENER_CALL = "call_secp6_offen";
const GESCHLOSSENER_CALL = "call_secp6_inbound";
const FREMDES_WERKZEUG = "book_appointment";

const WERKZEUGSATZ_OFFEN = ["end_call", "get_consult", "look_up", "take_message"];
const WERKZEUGSATZ_BASIS = ["end_call", "take_message"];

let claude;

const namen = (call) => claude.agentTools(call).map((werkzeug) => werkzeug.name).sort();

before(async () => {
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  process.env.LOOKUP_ENABLED = "true";
  process.env.EXA_API_KEY = "test-secp6-exa-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({
          id: OFFENER_CALL,
          answeredAt: new Date().toISOString(),
          consultPolledAtMs: Date.now(),
        }),
        seedCall({ id: GESCHLOSSENER_CALL, direction: "inbound" }),
      ],
    }),
  );
  claude = await import("../src/claude.js");
});

test("SEC-P6-13: bei offenen Kanaelen ist der Werkzeugsatz EXAKT diese vier", async () => {
  const store = await import("../src/store.js");
  assert.deepEqual(namen(store.getCall(OFFENER_CALL)), WERKZEUGSATZ_OFFEN);
});

test("SEC-P6-14: ohne Kanaele bleibt exakt der Basissatz", async () => {
  const store = await import("../src/store.js");
  assert.deepEqual(namen(store.getCall(GESCHLOSSENER_CALL)), WERKZEUGSATZ_BASIS);
});

test("SEC-P6-15: kein Werkzeug ausserhalb des Satzes wird im Zug behandelt", async () => {
  const store = await import("../src/store.js");
  const call = store.getCall(OFFENER_CALL);
  const { localeFor } = await import("../src/i18n/locales.js");
  const turnControl = localeFor(call.language).prompt.turnControl;
  assert.equal(
    claude.execTool(call, FREMDES_WERKZEUG, {}),
    turnControl.unknownTool,
    "ein Name ausserhalb des Satzes wird bedient statt abgewiesen",
  );
  assert.equal(
    claude.isSideEffectOnlyTool(FREMDES_WERKZEUG),
    false,
    "ein unbekannter Name gilt als seiteneffekt-frei (fail-safe Richtung, Bestand)",
  );
});
