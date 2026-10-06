import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";

function toolOnlyMessage() {
  return {
    id: "msg_fallback_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "tool_use", id: "tu_1", name: "take_message", input: { message: "Test" } }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 5 },
  };
}

let server;
let agentTurn, store, LOCALES;

before(async () => {
  server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(toolOnlyMessage()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-fallback-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({ id: "call_fb_in", direction: "inbound", language: "de" }),
        seedCall({ id: "call_fb_out", direction: "outbound", language: "de" }),
        seedCall({ id: "call_fb_out_fr", direction: "outbound", language: "fr" }),
        seedCall({ id: "call_fb_in_en", direction: "inbound", language: "en" }),
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ agentTurn } = await import("../src/claude.js"));
  ({ LOCALES } = await import("../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("I2-1: Inbound-Fallback DE ist der gepinnte DE-Satz", async () => {
  const call = store.getCall("call_fb_in");
  const { speech } = await agentTurn(call, "Hallo?");
  assert.equal(speech, "Alles klar, vielen Dank für Ihren Anruf. Auf Wiederhören!");
  assert.equal(speech, LOCALES.de.turnFallbackSpeech.inbound);
});

test("I2-2: Outbound-Fallback DE nutzt die richtungsspezifische Variante (nicht die Inbound-Formulierung)", async () => {
  const call = store.getCall("call_fb_out");
  const { speech } = await agentTurn(call, "Hallo?");
  assert.equal(speech, LOCALES.de.turnFallbackSpeech.outbound);
  assert.notEqual(speech, LOCALES.de.turnFallbackSpeech.inbound);
});

test("I2-3: Outbound-Fallback FR ist franzoesisch (sprachabhaengig + richtungsabhaengig)", async () => {
  const call = store.getCall("call_fb_out_fr");
  const { speech } = await agentTurn(call, "Bonjour ?");
  assert.equal(speech, LOCALES.fr.turnFallbackSpeech.outbound);
});

test("I2-4: Inbound-Fallback EN ist englisch (sprachabhaengig)", async () => {
  const call = store.getCall("call_fb_in_en");
  const { speech } = await agentTurn(call, "Hi?");
  assert.equal(speech, LOCALES.en.turnFallbackSpeech.inbound);
});
