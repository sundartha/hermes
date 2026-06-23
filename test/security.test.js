// Phase-1-Regressionstests: Twilio-Signatur, Basic-Auth (fail-closed, kein
// Header-Spoofing), MCP-Auth fail-closed. Diese Gates duerfen nie aufweichen.
import { test } from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { startServer, externalIp, BASE_ENV, OWNER_TEST_NUMBER } from "./helpers.js";

const EXTERNAL_IP = externalIp();

test("healthz ist offen erreichbar", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await srv.stop();
  }
});

test("Twilio-Signaturpruefung fuer /voice/*", async (t) => {
  const srv = await startServer({ env: { SKIP_TWILIO_SIGNATURE_CHECK: "false" } });
  try {
    const url = `${BASE_ENV.PUBLIC_URL}/voice/incoming`;
    const params = { CallSid: "CAtest123", From: "+4915112345678", To: OWNER_TEST_NUMBER.e164 };

    await t.test("ohne Signatur -> 403", async () => {
      const res = await fetch(`${srv.localUrl}/voice/incoming`, {
        method: "POST",
        body: new URLSearchParams(params),
      });
      assert.equal(res.status, 403);
    });

    await t.test("mit falscher Signatur -> 403", async () => {
      const res = await fetch(`${srv.localUrl}/voice/incoming`, {
        method: "POST",
        headers: { "X-Twilio-Signature": "invalid" },
        body: new URLSearchParams(params),
      });
      assert.equal(res.status, 403);
    });

    await t.test("mit gueltiger Signatur -> 200 + TwiML", async () => {
      const signature = twilio.getExpectedTwilioSignature(BASE_ENV.TWILIO_AUTH_TOKEN, url, params);
      const res = await fetch(`${srv.localUrl}/voice/incoming`, {
        method: "POST",
        headers: { "X-Twilio-Signature": signature },
        body: new URLSearchParams(params),
      });
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<Response>/);
    });
  } finally {
    await srv.stop();
  }
});

test(
  "Basic-Auth fuer Dashboard + API",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async (t) => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      await t.test("localhost ist ausgenommen (interne MCP-Tools)", async () => {
        const res = await fetch(`${srv.localUrl}/api/state`);
        assert.equal(res.status, 200);
      });

      await t.test("extern ohne Credentials -> 401", async () => {
        const res = await fetch(`${srv.externalUrl}/api/state`);
        assert.equal(res.status, 401);
      });

      await t.test("X-Forwarded-For-Spoofing umgeht Auth NICHT", async () => {
        const res = await fetch(`${srv.externalUrl}/api/state`, {
          headers: { "X-Forwarded-For": "127.0.0.1" },
        });
        assert.equal(res.status, 401);
      });

      await t.test("extern mit korrekten Credentials -> 200", async () => {
        const auth = "Basic " + Buffer.from("admin:test-geheim").toString("base64");
        const res = await fetch(`${srv.externalUrl}/api/state`, {
          headers: { Authorization: auth },
        });
        assert.equal(res.status, 200);
      });
    } finally {
      await srv.stop();
    }
  },
);

test(
  "/mcp fail-closed ohne MCP_AUTH_TOKEN",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async (t) => {
    const srv = await startServer();
    try {
      await t.test("extern -> 401", async () => {
        const res = await fetch(`${srv.externalUrl}/mcp`, { method: "POST" });
        assert.equal(res.status, 401);
      });

      await t.test("localhost -> kein 401", async () => {
        const res = await fetch(`${srv.localUrl}/mcp`, { method: "POST" });
        assert.notEqual(res.status, 401);
      });
    } finally {
      await srv.stop();
    }
  },
);

test("/mcp mit MCP_AUTH_TOKEN verlangt korrektes Bearer-Token", async (t) => {
  const srv = await startServer({ env: { MCP_AUTH_TOKEN: "test-mcp-token" } });
  try {
    await t.test("ohne Token -> 401 (auch von localhost)", async () => {
      const res = await fetch(`${srv.localUrl}/mcp`, { method: "POST" });
      assert.equal(res.status, 401);
    });

    await t.test("falsches Token -> 401", async () => {
      const res = await fetch(`${srv.localUrl}/mcp`, {
        method: "POST",
        headers: { Authorization: "Bearer falsch" },
      });
      assert.equal(res.status, 401);
    });

    await t.test("korrektes Token -> kein 401", async () => {
      const res = await fetch(`${srv.localUrl}/mcp`, {
        method: "POST",
        headers: { Authorization: "Bearer test-mcp-token" },
      });
      assert.notEqual(res.status, 401);
    });
  } finally {
    await srv.stop();
  }
});
