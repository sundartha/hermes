// P3 — Realtime-Audio-Haertung (OT-2). Offline-Tests fuer die quellseitigen Crash-Guards
// in bridge.js:
//   - canSend-Vorbedingung (Teil B / AC3): Send nur auf OPEN-Socket, keine Magic-Number.
//   - Provider-message-Handler (Teil A+C / AC2+AC4): ein malformter start-Frame ueber /media
//     darf den Prozess NICHT killen und NICHT zum P0-uncaughtException-Backstop entkommen.
// Der OpenAI-WS-Handler (AC1) waehlt AUSwaerts (wss://api.openai.com) und ist im gespawnten
// Server nicht injizierbar; er ist abgedeckt durch try/catch-Symmetrie zum Provider-Handler
// plus den manuellen Real-Call-Smoke (HEIKLE STELLE, Pflicht-Gate). Der Extract fuer echte
// AC1-Unit-Coverage ist bewusst nach P4 (Decomposition) verschoben.
import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { canSend } from "../src/bridge.js";
import { startServer, waitForLog } from "./helpers.js";

test("canSend: nur ein OPEN-Socket darf senden (T-P3-03)", () => {
  assert.equal(canSend({ readyState: WebSocket.OPEN }), true);
  assert.equal(canSend({ readyState: WebSocket.CONNECTING }), false);
  assert.equal(canSend({ readyState: WebSocket.CLOSING }), false);
  assert.equal(canSend({ readyState: WebSocket.CLOSED }), false);
  assert.equal(canSend(null), false);
  assert.equal(canSend(undefined), false);
});

function wsOpen(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

// Regression auf System-Ebene fuer den quellseitigen Fix: ein start-Frame OHNE .start-Objekt.
// Master (ungehaertet): der Twilio-Adapter dereft msg.start.streamSid -> TypeError -> entkommt
// dem Provider-message-Handler -> P0-uncaughtException-Backstop ([guard] uncaughtException).
// Gehaertet: callId=undefined -> store.getCall -> null -> "unbekannte call_id, trenne" + sauberer
// Socket-Close; der aeussere try/catch faengt jeden Rest. Diskriminator = das [guard]-Log fehlt.
test("Provider-message-Handler: malformter start-Frame erreicht den P0-Backstop nicht (AC2/AC4)", async () => {
  const srv = await startServer({ env: { VOICE_ENGINE: "realtime" } });
  try {
    const ws = await wsOpen(`ws://127.0.0.1:${srv.port}/media`);
    ws.send(JSON.stringify({ event: "start" })); // KEIN .start-Objekt
    await waitForLog(srv, /unbekannte call_id, trenne/, 4000);
    assert.ok(
      !srv.stdout.includes("[guard] uncaughtException"),
      "Throw aus dem Provider-Handler ist zum P0-Backstop entkommen:\n" + srv.stdout
    );
    try { ws.close(); } catch {}
  } finally {
    await srv.stop();
  }
});
