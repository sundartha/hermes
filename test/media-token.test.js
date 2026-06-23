// Phase 2.3: /media-WebSocket nur mit gueltigem stream_token; das Token
// darf in keiner API-Antwort auftauchen.
import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer, seedState, seedCall, OWNER_TEST_NUMBER } from "./helpers.js";

const TOKEN = "a".repeat(32);
const CALL_ID = "call_test1";

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

// true, wenn der Server die Verbindung innerhalb von ms trennt
function closedWithin(ws, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    ws.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function sendStart(ws, customParameters) {
  ws.send(JSON.stringify({ event: "start", start: { streamSid: "MZtest", customParameters } }));
}

test("/media-WebSocket: stream_token-Pruefung", async (t) => {
  const srv = await startServer({
    seed: seedState({ calls: [seedCall({ id: CALL_ID, streamToken: TOKEN })] }),
  });
  const mediaUrl = `ws://127.0.0.1:${srv.port}/media`;
  try {
    await t.test("falsches Token -> Socket wird getrennt", async () => {
      const ws = await wsConnect(mediaUrl);
      sendStart(ws, { call_id: CALL_ID, stream_token: "b".repeat(32) });
      assert.equal(await closedWithin(ws, 2000), true);
    });

    await t.test("fehlendes Token -> Socket wird getrennt", async () => {
      const ws = await wsConnect(mediaUrl);
      sendStart(ws, { call_id: CALL_ID });
      assert.equal(await closedWithin(ws, 2000), true);
    });

    await t.test("abgelehnter Stream beendet den Call-Record NICHT", async () => {
      const call = srv.readStore().calls.find((c) => c.id === CALL_ID);
      assert.equal(call.status, "active");
    });

    await t.test("korrektes Token -> Stream bleibt offen", async () => {
      const ws = await wsConnect(mediaUrl);
      sendStart(ws, { call_id: CALL_ID, stream_token: TOKEN });
      assert.equal(await closedWithin(ws, 500), false);
      ws.close();
    });

    await t.test("keine API-Antwort enthaelt streamToken", async () => {
      for (const path of ["/api/state", `/api/calls/${CALL_ID}`]) {
        const res = await fetch(`${srv.localUrl}${path}`);
        assert.equal(res.status, 200);
        const body = JSON.stringify(await res.json());
        assert.ok(!body.includes(TOKEN), `${path} leakt den Token-Wert`);
        assert.ok(!body.includes("streamToken"), `${path} leakt das Feld streamToken`);
      }
    });
  } finally {
    await srv.stop();
  }
});

test("TwiML der Realtime-Engine traegt das stream_token des Calls", async () => {
  const srv = await startServer({ env: { VOICE_ENGINE: "realtime" } });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      // To = geseedete Owner-Nummer (P3c): unbekannte To wuerde fail-closed greifen.
      body: new URLSearchParams({
        CallSid: "CAtest",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.equal(res.status, 200);
    const twiml = await res.text();
    const created = srv.readStore().calls[0];
    assert.ok(created.streamToken, "Call hat ein streamToken im Store");
    assert.match(twiml, /name="stream_token"/);
    assert.ok(twiml.includes(`value="${created.streamToken}"`), "TwiML traegt den Token-Wert");
  } finally {
    await srv.stop();
  }
});
