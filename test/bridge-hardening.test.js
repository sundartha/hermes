// P3 — Realtime-Audio-Haertung (OT-2). Offline-Tests fuer die quellseitigen Crash-Guards
// in bridge.js:
//   - canSend-Vorbedingung (Teil B / AC3): Send nur auf OPEN-Socket, keine Magic-Number.
//   - Provider-message-Handler (Teil A+C / AC2+AC4): ein malformter start-Frame ueber den
//     Media-WS darf den Prozess NICHT killen und NICHT zum P0-uncaughtException-Backstop
//     entkommen. C-P4: der Pfad kommt aus MEDIA_PATH statt als Literal "/media" - der
//     frueher hier benutzte Twilio-Pfad existiert nicht mehr und wuerde die Verbindung
//     fail-closed verwerfen, womit der Test seinen Gegenstand still verloren haette.
// Der OpenAI-WS-Handler (AC1) waehlt AUSwaerts (wss://api.openai.com) und ist im gespawnten
// Server nicht injizierbar; er ist abgedeckt durch try/catch-Symmetrie zum Provider-Handler
// plus den manuellen Real-Call-Smoke (HEIKLE STELLE, Pflicht-Gate). Der Extract fuer echte
// AC1-Unit-Coverage ist bewusst nach P4 (Decomposition) verschoben.
import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { canSend, MEDIA_PATH } from "../src/bridge.js";
import { PROVIDER } from "../src/store/defaults.js";
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
// Master (ungehaertet): der Adapter dereferenziert msg.start.<feld> -> TypeError -> entkommt
// dem Provider-message-Handler -> P0-uncaughtException-Backstop ([guard] uncaughtException).
// Gehaertet: callId=undefined -> store.getCall -> null -> "unbekannte call_id, trenne" + sauberer
// Socket-Close; der aeussere try/catch faengt jeden Rest. Diskriminator = das [guard]-Log fehlt.
test("Provider-message-Handler: malformter start-Frame erreicht den P0-Backstop nicht (AC2/AC4)", async () => {
  // KV2-2: das VOICE_ENGINE=realtime-Override ist HIER beweisbar wirkungslos gestrichen -
  // attachMediaBridge (src/boot.js) ist UNKONDITIONAL, der WS-Endpunkt existiert auch
  // unter der Default-Engine budget (Kommentar am Aufruf: "nur relevant bei
  // VOICE_ENGINE=realtime" beschreibt die NUTZUNG, nicht die Registrierung). Ohne den
  // Strich bootete dieser Spawn seit KV2-2(h) unter realtime gar nicht mehr (fataler
  // Riegel REALTIME_CARRIER_UNCOLLECTED) - Deckung dieses Tests unveraendert.
  const srv = await startServer();
  try {
    const ws = await wsOpen(`ws://127.0.0.1:${srv.port}${MEDIA_PATH[PROVIDER.TELNYX]}`);
    ws.send(JSON.stringify({ event: "start" })); // KEIN .start-Objekt
    await waitForLog(srv, /unbekannte call_id, trenne/, 4000);
    assert.ok(
      !srv.stdout.includes("[guard] uncaughtException"),
      "Throw aus dem Provider-Handler ist zum P0-Backstop entkommen:\n" + srv.stdout,
    );
    try {
      ws.close();
    } catch {}
  } finally {
    await srv.stop();
  }
});
