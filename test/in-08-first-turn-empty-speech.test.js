// IN-08 (PLAN-LAUNCH-TESTS.md): "extractSpeech-Praezedenz SpeechResult vs. Transcript" +
// "leere Speech beim ALLERERSTEN Turn (noch kein caller-Transcript) -> weitergathern, kein
// unnoetiger LLM-Call".
//
// Teil 1 (SpeechResult vs. Transcript Praezedenz) ist bereits abgedeckt: die Funktion heisst
// nach der Server-Slim-Decomposition nicht mehr `extractSpeech`, sondern
// `telnyxWebhookEvents.parseSpeechResult` (src/telephony/adapters/telnyx/webhook-events.js)
// und wird in test/webhook-events.test.js exakt so getestet ("Telnyx parseSpeechResult:
// Transcript hat Vorrang vor SpeechResult, sonst Fallback"). Kein neuer Test noetig, nur
// dieser Verweis.
//
// Teil 2 (dieser Test): der No-Speech-Kurzschluss in /voice/turn
// (`if (!heard && callerHasSpoken(call)) return noSpeechOutcome(...)`, src/routes/voice.js)
// greift NUR, wenn callerHasSpoken(call) true ist - also wenn der Anrufer VORHER schon
// (mindestens einmal) etwas gesagt hat. Beim ALLERERSTEN Turn (Transkript hat noch KEINE
// caller-Zeile) ist callerHasSpoken(call) laut src/claude.js false, der Kurzschluss greift
// NICHT, und der Code faellt durch zu `agentTurn(call, heard || null)` - das ist ein
// tatsaechlicher LLM-Aufruf (mit heard=null statt eines No-Op-Reprompts). Dieser Test macht
// sichtbar, ob das heutige Verhalten wirklich einen LLM-Request ausloest.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

function textMessage(text) {
  return {
    id: "msg_in08",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 6 },
  };
}

async function startCountingMock(speech) {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(textMessage(speech)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get count() {
      return requestCount;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

test("IN-08: allererster Turn (Transkript hat nur die Agent-Begruessung, NOCH keine caller-Zeile) + leeres SpeechResult -> heutiges Verhalten dokumentieren", async () => {
  const mock = await startCountingMock("Hallo? Sind Sie noch da?");
  const id = "call_in08_first";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          direction: "inbound",
          status: "active",
          // Realistischer Erst-Turn-Zustand: /voice/incoming hat die Begruessung schon
          // eingetragen (store.addTranscript agent), aber der Anrufer hat NOCH NICHTS
          // gesagt - also KEINE caller-Zeile. callerHasSpoken(call) ist damit false.
          transcript: [{ role: "agent", text: "Guten Tag, wie kann ich helfen?" }],
        }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "" }), // leer, wie z.B. Stille/Hintergrundrauschen
    });
    assert.equal(res.status, 200);
    await res.text();

    // PLAN-LAUNCH-TESTS.md (Stand 2026-07-02) erwartet hier "weitergathern, kein
    // unnoetiger LLM-Call". Der aktuelle Code (src/routes/voice.js /voice/turn,
    // src/claude.js callerHasSpoken) kurzschliesst den No-Speech-Reprompt NUR, wenn
    // callerHasSpoken(call) true ist - beim allerersten Turn ist das false, also faellt
    // der Handler durch zu agentTurn(call, null) und macht TATSAECHLICH einen LLM-Call.
    // Dies ist eine bewusste, kommentierte Design-Entscheidung (G3/G26-Fix, R4-Empty-Turn-
    // Zaehler) - kein Versehen. Dieser Test haelt den heutigen IST-Zustand fest (dokumen-
    // tierend, siehe SMS-02/BILL-04-Konvention), OHNE ihn zu bewerten oder zu fixen.
    assert.equal(
      mock.count,
      1,
      "IST-Zustand (abweichend vom 2026-07-02-Plantext): der allererste leere Turn OHNE " +
        "caller-Zeile loest sehr wohl einen echten LLM-Call aus (agentTurn(call, null)), " +
        "weil callerHasSpoken(call) beim ersten Turn false ist und der No-Speech-Kurzschluss " +
        "nur bei bereits erfolgtem Caller-Sprechen greift (src/claude.js callerHasSpoken, " +
        "src/routes/voice.js /voice/turn)",
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("IN-08 Kontrastfall: leerer Turn NACHDEM der Anrufer schon gesprochen hat -> No-Speech-Reprompt, KEIN LLM-Call (Bestandsverhalten, siehe g4-no-speech-reprompt.test.js)", async () => {
  const mock = await startCountingMock("sollte nicht aufgerufen werden");
  const id = "call_in08_after";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          direction: "inbound",
          status: "active",
          transcript: [
            { role: "agent", text: "Guten Tag, wie kann ich helfen?" },
            { role: "caller", text: "Ich haette gerne einen Termin." },
          ],
        }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "" }),
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<Say[^>]*>Können Sie das bitte wiederholen\?<\/Say>/);
    assert.equal(mock.count, 0, "sobald callerHasSpoken true ist, greift der No-Speech-Kurzschluss VOR agentTurn - kein LLM-Call");
  } finally {
    await srv.stop();
    await mock.close();
  }
});
