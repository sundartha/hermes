// Phase 2.1: Rate-Limiting fuer Nicht-Twilio-Routen (RATE_LIMIT_PER_MIN).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp } from "./helpers.js";

const EXTERNAL_IP = externalIp();
const LIMIT = 3;

test("Rate-Limiting", { skip: !EXTERNAL_IP && "keine externe Interface-IP" }, async (t) => {
  const srv = await startServer({ env: { RATE_LIMIT_PER_MIN: String(LIMIT) } });
  try {
    await t.test("Request N+1 von Nicht-localhost-IP -> 429 mit JSON-Error", async () => {
      const statuses = [];
      for (let i = 0; i < LIMIT + 1; i++) {
        const res = await fetch(`${srv.externalUrl}/healthz`);
        statuses.push(res.status);
        if (res.status === 429) {
          const body = await res.json();
          assert.ok(body.error, "429-Response traegt JSON-Error");
        }
      }
      assert.deepEqual(statuses, [200, 200, 200, 429]);
    });

    await t.test("localhost-Socket ist ausgenommen", async () => {
      for (let i = 0; i < LIMIT + 2; i++) {
        const res = await fetch(`${srv.localUrl}/healthz`);
        assert.equal(res.status, 200);
      }
    });

    await t.test("/voice/* ist ausgenommen (Twilio-Webhooks)", async () => {
      for (let i = 0; i < LIMIT + 2; i++) {
        // SKIP_TWILIO_SIGNATURE_CHECK=true im Test-Env: unbekannte callId -> 200 + Hangup-TwiML
        const res = await fetch(`${srv.externalUrl}/voice/turn?callId=missing`, {
          method: "POST",
          body: new URLSearchParams({ SpeechResult: "" }),
        });
        assert.equal(res.status, 200);
      }
    });
  } finally {
    await srv.stop();
  }
});

// AM1-Regression (KEIN externes Interface noetig -> nie geskippt): hinter Render erscheint
// externer Traffic als Loopback-Socket, traegt aber X-Forwarded-For. Die alte
// isLocalSocket-Ausnahme haette damit das Rate-Limit fuer den ganzen Internet-Traffic
// ausgehebelt. isTrustedLocalCaller nimmt nur ECHTES In-Process-Loopback (ohne XFF) aus.
test("Rate-Limiting: Loopback-Socket mit X-Forwarded-For ist NICHT ausgenommen (Render-Proxy)", async () => {
  const srv = await startServer({ env: { RATE_LIMIT_PER_MIN: String(LIMIT) } });
  try {
    const statuses = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      const res = await fetch(`${srv.localUrl}/healthz`, {
        headers: { "X-Forwarded-For": "203.0.113.50" },
      });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  } finally {
    await srv.stop();
  }
});
