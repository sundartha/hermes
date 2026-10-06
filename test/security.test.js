import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp, OWNER_TEST_NUMBER, makeTelnyxSigner, nowSeconds } from "./helpers.js";

const EXTERNAL_IP = externalIp();

test("healthz ist offen erreichbar", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  } finally {
    await srv.stop();
  }
});

test("Provider-Signaturpruefung (Telnyx/Ed25519) fuer /voice/*", async (t) => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
  });
  try {
    const body = new URLSearchParams({
      CallSid: "CAtest123",
      From: "+4915112345678",
      To: OWNER_TEST_NUMBER.e164,
    }).toString();
    const post = (extraHeaders = {}) =>
      fetch(`${srv.localUrl}/voice/incoming`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...extraHeaders },
        body,
      });

    await t.test("ohne Signatur -> 403", async () => {
      assert.equal((await post()).status, 403);
    });

    await t.test("mit falscher Signatur -> 403", async () => {
      const res = await post({
        "telnyx-signature-ed25519": "invalid",
        "telnyx-timestamp": String(nowSeconds()),
      });
      assert.equal(res.status, 403);
    });

    await t.test("mit gueltiger Signatur -> 200 + TeXML", async () => {
      const ts = String(nowSeconds());
      const res = await post({
        "telnyx-signature-ed25519": signer.sign(ts, body),
        "telnyx-timestamp": ts,
      });
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<Response>/);
    });
  } finally {
    await srv.stop();
  }
});

test(
  "Auth fail-closed (internalOnly) fuer Dashboard + API",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async (t) => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      await t.test("localhost ist ausgenommen (interne MCP-Tools)", async () => {
        const res = await fetch(`${srv.localUrl}/api/state`);
        assert.equal(res.status, 200);
      });

      await t.test("extern ohne Credentials -> 403", async () => {
        const res = await fetch(`${srv.externalUrl}/api/state`);
        assert.equal(res.status, 403);
      });

      await t.test("X-Forwarded-For-Spoofing umgeht Auth NICHT", async () => {
        const res = await fetch(`${srv.externalUrl}/api/state`, {
          headers: { "X-Forwarded-For": "127.0.0.1" },
        });
        assert.equal(res.status, 403);
      });
    } finally {
      await srv.stop();
    }
  },
);

test("internalOnly: Loopback-Socket + X-Forwarded-For umgeht Auth NICHT (Render-Proxy)", async (t) => {
  const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
  try {
    await t.test("Loopback OHNE X-Forwarded-For -> 200 (echter In-Process-MCP-Aufruf)", async () => {
      const res = await fetch(`${srv.localUrl}/api/state`);
      assert.equal(res.status, 200);
    });

    await t.test("Loopback MIT X-Forwarded-For ohne Credentials -> 403 (extern via Proxy)", async () => {
      const res = await fetch(`${srv.localUrl}/api/state`, {
        headers: { "X-Forwarded-For": "203.0.113.9" },
      });
      assert.equal(res.status, 403);
    });
  } finally {
    await srv.stop();
  }
});

test(
  "/mcp fail-closed ohne MCP_AUTH_TOKEN",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async (t) => {
    const srv = await startServer();
    try {
      await t.test("extern -> 401", async () => {
        const res = await fetch(`${srv.externalUrl}/mcp`, { method: "POST" });
        assert.equal(res.status, 401);
        assert.equal(res.headers.get("www-authenticate"), 'Bearer error="invalid_token"');
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
