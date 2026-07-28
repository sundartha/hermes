// Lokaler Telnyx-Call-Control-Fake fuer den Shim-Treiber der Conversation-Bench.
// KEIN Netz nach draussen: TELNYX_API_BASE des gespawnten Servers zeigt hierher.
// Faengt genau die drei Actions ab, die der Assistant-Pfad absetzt (speak /
// ai_assistant_start / hangup) und macht ihre Bodies fuer den Treiber lesbar - so
// stammt der gemessene Eroeffnungstext aus dem SERVER, nie aus einer Bench-Fixture.
import http from "node:http";

const ACTION_URL_RE = /^\/v2\/calls\/([^/]+)\/actions\/([^/?]+)/;
const ACTION_POLL_INTERVAL_MS = 10;
const ACTION_WAIT_TIMEOUT_MS = 5000;

// Fail-closed-Signatur-Header: SKIP_TWILIO_SIGNATURE_CHECK umgeht nur die KRYPTO-
// Pruefung, NICHT providerFromHeaders - dessen Header-Praesenz entscheidet, ob
// /voice/incoming als Telnyx gerendert wird. Werte sind Dummies (Muster
// test/telnyx-signature.test.js). Verschoben aus runner.mjs (G5: EINE Quelle,
// beide Treiber brauchen sie).
export const TELNYX_DUMMY_HEADERS = Object.freeze({
  "telnyx-signature-ed25519": "bench-dummy",
  "telnyx-timestamp": "0",
});

// Telnyx-v2-Event-Huelle {data:{event_type,payload}} - die Form, die
// src/telephony/adapters/telnyx/speak-events.js#eventEnvelope erwartet. status wird
// NUR gesetzt, wenn der Aufrufer einen mitgibt (call.speak.ended braucht
// status:"completed", sonst stuft parseSpeakEvent es nicht als OK ein).
export function callControlEventBody({ eventType, callControlId, status }) {
  const payload = { call_control_id: callControlId };
  if (status !== undefined) payload.status = status;
  return { data: { event_type: eventType, payload } };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

// Startet den Fake. actions[] sammelt {callControlId, action, body} in Reihenfolge.
export async function startTelnyxFake() {
  const actions = [];

  const server = http.createServer(async (req, res) => {
    const match = req.url.match(ACTION_URL_RE);
    if (!match) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ code: "not_found", title: "unknown path" }] }));
      return;
    }
    const raw = await readBody(req);
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    actions.push({ callControlId: match[1], action: match[2], body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: {} }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  // Pollt actions[] bis zum Treffer (callControlId+action). handleCallControlEvent
  // sendet res.sendStatus(200) VOR der Arbeit - der fetch des Treibers ist zurueck,
  // bevor die Action (z.B. speak) ueberhaupt raus ist.
  async function waitForAction({ callControlId, action, timeoutMs = ACTION_WAIT_TIMEOUT_MS }) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = actions.find((a) => a.callControlId === callControlId && a.action === action);
      if (hit) return hit;
      if (Date.now() > deadline) {
        throw new Error(`telnyx-fake: Action "${action}" fuer callControlId=${callControlId} nicht eingetroffen`);
      }
      await new Promise((r) => setTimeout(r, ACTION_POLL_INTERVAL_MS));
    }
  }

  return {
    url,
    actions,
    waitForAction,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
