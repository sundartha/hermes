// Phase-1-Regressionstests: Provider-Signatur (Telnyx/Ed25519), Auth fail-closed
// (internalOnly, kein Header-Spoofing), MCP-Auth fail-closed. Diese Gates duerfen nie
// aufweichen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp, OWNER_TEST_NUMBER, makeTelnyxSigner, nowSeconds } from "./helpers.js";

const EXTERNAL_IP = externalIp();

test("healthz ist offen erreichbar", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    // GAP-36 (P1): /healthz traegt zusaetzlich commit+configHash (Deploy-Wahrheit,
    // s. test/gap-36-healthz-fingerprint.test.js) - hier nur die Auth-Ausnahme selbst
    // geprueft (ok:true bleibt Teil der Form).
    const body = await res.json();
    assert.equal(body.ok, true);
  } finally {
    await srv.stop();
  }
});

// C-P3: Signaturpruefung des EINZIGEN verbliebenen Inbound-Verifizierers (Telnyx,
// Ed25519), end-to-end ueber die echte HTTP-Route. Loest den Twilio-Aequivalenttest ab.
// Der dritte Unterfall ist der Grund fuer diesen Test: er ist der EINZIGE Beleg, dass
// das Gate legitimen Verkehr NICHT blockiert - ein Gate, das alles ablehnt, besteht
// jeden Negativ-Test. Unterfall 2 ist seine eingebaute Gegenprobe (gleiche Route,
// gleicher Schluessel, nur die Signatur ist Muell -> 403 statt 200).
test("Provider-Signaturpruefung (Telnyx/Ed25519) fuer /voice/*", async (t) => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
  });
  try {
    // Signiert werden die EXAKTEN Bytes auf der Leitung -> Body einmal als String bauen,
    // denselben String signieren und senden. Content-Type explizit: ohne ihn greift
    // express.urlencoded nicht, req.rawBody bliebe leer und der Verifizierer haette
    // nichts zu pruefen - der 403 kaeme aus dem falschen Grund.
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

      // AUTH-P7: kein Basic-Auth-Gate mehr davor - internalOnly ist die einzige
      // Sicherung. Ein externer Aufrufer bekommt 403, nicht mehr 401.
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

// AM1-Regression (KEIN externes Interface noetig -> nie geskippt): Hinter einem Reverse-
// Proxy (Render) ist req.socket.remoteAddress fuer JEDEN von aussen kommenden Request der
// Loopback-Sidecar -> die alte isLocalSocket-Ausnahme hat Dashboard + API fuer das ganze
// Internet OHNE Passwort geoeffnet (GET /api/state lieferte live 200 mit Owner-Daten). Der
// Proxy setzt zusaetzlich X-Forwarded-For, ein echter In-Process-Loopback-Aufruf NICHT.
// localUrl = Loopback-Socket -> simuliert exakt die Proxy->App-Verbindung.
test("internalOnly: Loopback-Socket + X-Forwarded-For umgeht Auth NICHT (Render-Proxy)", async (t) => {
  const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
  try {
    await t.test("Loopback OHNE X-Forwarded-For -> 200 (echter In-Process-MCP-Aufruf)", async () => {
      const res = await fetch(`${srv.localUrl}/api/state`);
      assert.equal(res.status, 200);
    });

    // AUTH-P7: kein Basic-Auth-Gate mehr davor - internalOnly ist die einzige
    // Sicherung. Ein Aufrufer mit X-Forwarded-For (Proxy-simulierter Extern-Zugriff)
    // bekommt 403, nicht mehr 401.
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
        // P6: einziger Draht-Beleg fuer den Legacy-Zweig (auth.js) ueber einen
        // echten Nicht-Loopback-Socket - skippt maschinenabhaengig (EXTERNAL_IP),
        // die Beweislast traegt deshalb test/openai-p6-challenge.test.js (P6-T4).
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
