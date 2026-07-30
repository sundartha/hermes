// G3/G26-Fix (Runde 2, Review zu phase/stab-p7-fix-g326-r1): Beweist per ECHTEM
// /voice/turn-HTTP-Aufruf (nicht nur agentTurn direkt wie claude-turn-guard.test.js - genau
// diese Luecke stellte der Review-Blocker fest), dass server.js's No-Speech-Kurzschluss
// ("kein Speech gehoert -> nur ein statischer Reprompt, agentTurn wird uebersprungen") NICHT
// mehr dauerhaft vor agentTurn steht, sobald outbound nur eine nicht-substanzielle Rausch-
// Zeile aufgezeichnet wurde.
//
// Sequenz: /voice/outbound (Opening, LLM-frei) -> /voice/turn mit Rausch-SpeechResult "."
// (R2: end_call bleibt unterdrueckt, KEIN Hangup) -> /voice/turn mit WIRKLICH leerem
// SpeechResult (kein STT-Ergebnis) -> muss trotzdem agentTurn aufrufen (nicht den
// statischen Reprompt) und nach Erreichen von maxEmptyTurns per end_call auflegen (R4).
//
// VOR diesem Fix haette server.js's Kurzschluss (call.transcript.some(role==="caller"),
// OHNE Substanz-Filter) nach dem Rausch-Turn JEDEN weiteren stillen Turn kurzgeschlossen
// und agentTurn nie wieder aufgerufen - der R4-Empty-Turn-Zaehler (unansweredAgentTurns,
// nur bei echtem agentTurn-Aufruf neu ausgewertet) waere eingefroren, der Call haette bis
// der Max-Dauer-Frist re-promptet statt nach maxEmptyTurns geordnet aufzulegen.
//
// MAX_EMPTY_TURNS="2" (kuerzeste testbare Schwelle, F.I.R.S.T.); CALLER_SUBSTANCE_MIN_LEN
// bleibt der BASE_ENV-Prod-Default (2). Spawn-Test (echte HTTP-Route, kein In-Process-Import
// von agentTurn) - eigene Datei, ueberschneidet keine parallele Phase.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

// Antwortet JEDEN Turn mit end_call + Sprechtext - ob der Wunsch durchgereicht wird,
// entscheidet allein suppressEndCall (claude.js); der Mock selbst verhaelt sich konstant.
function endCallMessage(speech) {
  return {
    id: "msg_g326_endcall",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [
      { type: "text", text: speech },
      { type: "tool_use", id: "tu1", name: "end_call", input: {} },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 6 },
  };
}

async function startEndCallMock() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(endCallMessage("Ich lege jetzt auf.")));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("G3/G26 Runde 2: Rausch-Turn dann echte Dauerstille - der R4-Deadlock-Schutz bleibt ueber /voice/turn erreichbar", async () => {
  const mock = await startEndCallMock();
  const id = "call_g326_shortcut";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url, MAX_EMPTY_TURNS: "2" },
    seed: seedState({
      calls: [seedCall({ id, provider: "twilio", status: "active", direction: "outbound" })],
    }),
  });
  try {
    // Opening (LLM-frei, schreibt die erste agent-Zeile synchron - wie im echten Call).
    const openRes = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest" }),
    });
    assert.equal(openRes.status, 200);

    // Turn 1: Rausch-Fragment (nicht-substanziell, kuerzer als CALLER_SUBSTANCE_MIN_LEN=2).
    // heard ist truthy -> laeuft durch agentTurn, der Fruehauflege-Schutz bleibt aktiv (R2).
    const noiseRes = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "." }),
    });
    const noiseBody = await noiseRes.text();
    assert.match(noiseBody, /<Gather/, `Rausch-Turn muss weiterlaufen: ${noiseBody}`);
    assert.doesNotMatch(
      noiseBody,
      /<Hangup/,
      `Rausch darf end_call nicht freigeben (R2): ${noiseBody}`,
    );

    // Turn 2: WIRKLICH leeres SpeechResult (kein STT-Ergebnis, nicht nur Rauschen). Vor
    // diesem Fix haette server.js's Kurzschluss (jede caller-Zeile zaehlt als "gesprochen")
    // agentTurn hier uebersprungen und nur einen statischen Reprompt gerendert - der
    // R4-Zaehler waere nie befragt worden.
    const silentRes = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "" }),
    });
    const silentBody = await silentRes.text();
    assert.match(
      silentBody,
      /<Hangup/,
      `nach maxEmptyTurns muss der Guard trotz Rausch-Historie auflegen: ${silentBody}`,
    );

    // Vollstaendiges Transkript bleibt erhalten (G3): die Rausch-Zeile "." steht im Call,
    // obwohl sie den Empty-Turn-Zaehler nicht zuruecksetzt hat.
    const stored = srv.readStore();
    const call = stored.calls.find((c) => c.id === id);
    const callerLines = call.transcript.filter((t) => t.role === "caller");
    assert.equal(callerLines.length, 1);
    assert.equal(callerLines[0].text, ".");
  } finally {
    await srv.stop();
    await mock.close();
  }
});
