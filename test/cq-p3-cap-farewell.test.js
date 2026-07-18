// P3.1 (PLAN-CONVERSATION-QUALITY-V2): Abschied VOR dem harten Max-Dauer-Cap. Beweist per
// echtem /voice/turn-HTTP-Aufruf, dass eine knapp bemessene maxDurationS (< CAP_FAREWELL_
// LEAD_MS) sofort einen deterministischen Abschluss-Satz + Hangup rendert statt eines
// Folge-Gathers, den der wortlose Timer-Backstop (terminateCappedCall) Sekunden spaeter
// ohnehin abgeschnitten haette. P3-C2 ist die Gegenprobe (grosszuegige Restzeit -> normaler
// Turn). P3-C3 (Backstop unveraendert) ist bewusst KEIN neuer Test hier - siehe Kommentar
// unten, Abnahmekriterium 2 wird von der unveraenderten Bestandssuite bewiesen.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

// Tool-freie Text-Antwort (Muster claude-turn-guard.test.js textMessage): der Tool-Loop
// bricht nach einem Roundtrip ab, KEIN end_call - der Cap-Vorlauf muss ALLEIN ueber die
// Restzeit ausloesen, nicht ueber ein vom Modell gewuenschtes end_call.
function textMessage(text) {
  return {
    id: "msg_p3c_text",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 6 },
  };
}

async function startTextMock(speech) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(textMessage(speech)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("P3-C1: Restzeit unter CAP_FAREWELL_LEAD_MS -> Abschluss-Satz + Hangup statt Folge-Gather", async () => {
  const mock = await startTextMock("Und wie lange dauert das ungefaehr?");
  const id = "call_p3c1";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url, CAP_FAREWELL_LEAD_MS: "20000" },
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          maxDurationS: 20, // < CAP_FAREWELL_LEAD_MS=20000ms -> remaining ist ab Call-Start < Vorlauf
          transcript: [{ role: "caller", text: "Ja gerne" }],
        }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Und wie lange dauert das?" }),
    });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(
      body,
      /<Say[^>]*>Ich muss das Gespräch jetzt leider beenden\. Vielen Dank für Ihre Zeit\. Auf Wiederhören\.<\/Say>/,
    );
    assert.match(body, /<Hangup/);
    assert.doesNotMatch(body, /<Gather/, `Cap-Vorlauf darf keinen Folge-Gather rendern: ${body}`);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("P3-C2 (Gegenprobe): grosszuegige Restzeit -> normaler Turn, kein Cap-Abschied", async () => {
  const mock = await startTextMock("Und wie lange dauert das ungefaehr?");
  const id = "call_p3c2";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url, CAP_FAREWELL_LEAD_MS: "20000" },
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          maxDurationS: 180, // >> CAP_FAREWELL_LEAD_MS=20000ms -> remaining bleibt weit darueber
          transcript: [{ role: "caller", text: "Ja gerne" }],
        }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Und wie lange dauert das?" }),
    });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /<Gather/);
    assert.doesNotMatch(body, /<Hangup/);
    assert.doesNotMatch(
      body,
      /Ich muss das Gespräch jetzt leider beenden/,
      `Cap-Abschied darf bei grosszuegiger Restzeit nicht rendern: ${body}`,
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});

// P3-C3 (Backstop unveraendert, Abnahmekriterium 2): KEIN neuer Test hier - der Beweis ist
// die unveraendert gruene Bestandssuite test/max-duration-live-cap.test.js +
// test/max-duration-rearm.test.js (siehe Report). Diese Dateien pruefen terminateCappedCall/
// armMaxDurationTimer und sind von P3.1 nicht angefasst worden.
