import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const SUBSTANTIAL = "Ja, Donnerstag passt gut";

function antwort(content) {
  return {
    id: "msg_ter",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const werkzeug = (name, input, id) => ({ type: "tool_use", id, name, input });
const ENDE = antwort([{ type: "text", text: "Ende." }]);
ENDE.stop_reason = "end_turn";

async function laufe({ id, gesagt, werkzeuge }) {
  const antworten = [antwort(werkzeuge), ENDE];
  const bodies = [];
  const mock = await starteAttrappe((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(antworten.shift() || ENDE));
    });
  });
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({ calls: [seedCall({ id, provider: "telnyx", status: "active", direction: "outbound", language: "de" })] }),
  });
  try {
    await abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: gesagt }),
    });
  } finally {
    await srv.stop();
    await mock.close();
  }
  return { bodies, store: srv.readStore() };
}

const ergebnisse = (bodies) => {
  const letzte = bodies[1].messages.at(-1);
  return letzte.content.map((c) => c.content);
};
const MELDUNG = werkzeug("take_message", { message: "Bitte zurueckrufen" }, "tuA");
const AUFLEGEN = werkzeug("end_call", {}, "tuB");

test("take_message legt den Aktionspunkt mit der Art todo an", async () => {
  const { store } = await laufe({ id: "call_ter_1", gesagt: SUBSTANTIAL, werkzeuge: [MELDUNG] });
  assert.deepEqual(store.actionItems.map((i) => i.type), ["todo"]);
});

test("Ohne Aeusserung des Angerufenen bekommt end_call den Warte-Text, take_message derselben Runde sein Ergebnis", async () => {
  const { bodies } = await laufe({ id: "call_ter_2", gesagt: "", werkzeuge: [MELDUNG, AUFLEGEN] });
  const [meldung, auflegen] = ergebnisse(bodies);
  assert.notEqual(meldung, auflegen);
  assert.notEqual(auflegen, "OK");
  assert.match(auflegen, /noch nichts gesagt/);
  assert.doesNotMatch(meldung, /noch nichts gesagt/);
});

test("Nach einer Aeusserung des Angerufenen bekommt end_call OK und take_message sein Ergebnis", async () => {
  const { bodies } = await laufe({ id: "call_ter_3", gesagt: SUBSTANTIAL, werkzeuge: [MELDUNG, AUFLEGEN] });
  const [meldung, auflegen] = ergebnisse(bodies);
  assert.equal(auflegen, "OK");
  assert.notEqual(meldung, "OK");
  assert.doesNotMatch(meldung, /noch nichts gesagt/);
});
