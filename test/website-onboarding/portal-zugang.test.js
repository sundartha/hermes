import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog, startIdp } from "../helpers.js";
import { LOGIN_ALIAS_PATHS, APP_ALIAS_PATHS } from "../../src/portal-paths.js";

const HTTP_OK = 200;
const HTTP_FOUND = 302;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

const GATE_DETEKTOR = { DASHBOARD_PASSWORD: "auth-p7-darf-nichts-mehr-bewirken" };
const EXTERN = { "X-Forwarded-For": "203.0.113.9" };

function keineBasicChallenge(res, wo) {
  assert.equal(
    res.headers.get("www-authenticate"),
    null,
    `${wo}: keine Antwort darf eine Basic-Challenge tragen - das Gate ist gefallen`,
  );
}

test("AUTH-P7-1: /api/state ohne Sitzung -> 403, nicht 401, nicht 200 (der Datenleck-Fall)", async () => {
  const srv = await startServer({ env: GATE_DETEKTOR });
  try {
    const res = await fetch(`${srv.localUrl}/api/state`, { headers: EXTERN });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.notEqual(res.status, HTTP_UNAUTHORIZED, "kein Gate mehr");
    assert.notEqual(res.status, HTTP_OK, "200 waere der Datenleck-Fall - sofortiger Rollback");
    keineBasicChallenge(res, "GET /api/state");
    assert.ok((await res.json()).error);
    await waitForLog(srv, /\[audit\] auth_failed ip=\S+ path=\/api\/state grund=not_local/);
  } finally {
    await srv.stop();
  }
});

test("AUTH-P7-2: unbekannter Pfad -> 404, in beiden Raeumen, die frueher das Gate deckte", async () => {
  const srv = await startServer({ env: GATE_DETEKTOR });
  try {
    for (const pfad of ["/diese-route-gibt-es-nicht-12345", "/api/gibt-es-nicht-12345"]) {
      const res = await fetch(`${srv.localUrl}${pfad}`, { headers: EXTERN });
      assert.equal(res.status, HTTP_NOT_FOUND, pfad);
      keineBasicChallenge(res, `GET ${pfad}`);
    }
    const geloescht = await fetch(`${srv.localUrl}/api/settings`, {
      method: "POST",
      headers: { ...EXTERN, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(geloescht.status, HTTP_NOT_FOUND, "POST /api/settings (P4 geloescht) bleibt 404");
  } finally {
    await srv.stop();
  }
});

test("AUTH-P7-3: die sieben Umleitungen", async () => {
  const srv = await startServer({ env: GATE_DETEKTOR });
  try {
    const ERWARTUNG = [
      ["/login", "/auth/login"],
      ["/signin", "/auth/login"],
      ["/sign-in", "/auth/login"],
      ["/dashboard", "/app"],
      ["/account", "/app"],
      ["/portal", "/app"],
      ["/admin", "/app"],
    ];
    assert.deepEqual(
      [...LOGIN_ALIAS_PATHS, ...APP_ALIAS_PATHS],
      ERWARTUNG.map(([von]) => von),
    );
    for (const [von, ziel] of ERWARTUNG) {
      const res = await fetch(`${srv.localUrl}${von}`, { redirect: "manual" });
      assert.equal(res.status, HTTP_FOUND, von);
      assert.equal(res.headers.get("location"), ziel, von);
      keineBasicChallenge(res, `GET ${von}`);
    }
    const post = await fetch(`${srv.localUrl}/login`, { method: "POST", redirect: "manual" });
    assert.equal(post.status, HTTP_NOT_FOUND, "POST /login bleibt 404 (GET-only)");
    const admin = await fetch(`${srv.localUrl}/api/admin/tenants`, {
      redirect: "manual",
      headers: EXTERN,
    });
    assert.notEqual(admin.status, HTTP_FOUND, "/admin-Umleitung beschattet /api/admin/* nicht");
  } finally {
    await srv.stop();
  }
});

test("AUTH-P7-4: keine Antwort traegt eine Basic-Challenge - und die MCP-Bearer-Challenge ueberlebt (Gegenprobe zu B-1)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: { ...GATE_DETEKTOR, MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer },
  });
  try {
    const oeffentlich = await fetch(`${srv.localUrl}/healthz`);
    assert.doesNotMatch(oeffentlich.headers.get("www-authenticate") ?? "", /^Basic/i, "GET /healthz");

    const intern = await fetch(`${srv.localUrl}/api/state`, { headers: EXTERN });
    assert.equal(intern.status, HTTP_FORBIDDEN);
    assert.doesNotMatch(intern.headers.get("www-authenticate") ?? "", /^Basic/i, "GET /api/state");

    const fehlt = await fetch(`${srv.localUrl}/diese-route-gibt-es-nicht-12345`);
    assert.doesNotMatch(fehlt.headers.get("www-authenticate") ?? "", /^Basic/i, "GET /fehlt");

    const umleitung = await fetch(`${srv.localUrl}/login`, { redirect: "manual" });
    assert.doesNotMatch(umleitung.headers.get("www-authenticate") ?? "", /^Basic/i, "GET /login");

    const mcp = await fetch(`${srv.localUrl}/mcp`, { method: "POST" });
    assert.equal(mcp.status, HTTP_UNAUTHORIZED);
    assert.doesNotMatch(mcp.headers.get("www-authenticate") ?? "", /^Basic/i, "POST /mcp");
    assert.match(mcp.headers.get("www-authenticate") ?? "", /^Bearer /, "POST /mcp Bearer-Challenge");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("AUTH-P7-5: Pre-Mortem-Gegenprobe - der In-Process-MCP-Pfad lebt (echter Loopback, kein X-Forwarded-For)", async () => {
  const srv = await startServer({ env: GATE_DETEKTOR });
  try {
    const res = await fetch(`${srv.localUrl}/api/state`);
    assert.equal(res.status, HTTP_OK, "das gesetzte DASHBOARD_PASSWORD bewirkt nichts");
    const state = await res.json();
    assert.ok(Array.isArray(state.calls), "internalOnly sperrt den echten Loopback nicht aus");
  } finally {
    await srv.stop();
  }
});

test("AUTH-P7-7: das Legacy-Checkout-Paar traegt internalOnly", async () => {
  const srv = await startServer({ env: GATE_DETEKTOR });
  try {
    const setup = await fetch(`${srv.localUrl}/api/billing/setup-checkout`, {
      method: "POST",
      headers: { ...EXTERN, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(setup.status, HTTP_FORBIDDEN, "extern: POST /api/billing/setup-checkout");
    keineBasicChallenge(setup, "POST /api/billing/setup-checkout");
    await waitForLog(
      srv,
      /\[audit\] auth_failed ip=\S+ path=\/api\/billing\/setup-checkout grund=not_local/,
    );

    const ret = await fetch(`${srv.localUrl}/api/billing/checkout-return?session_id=cs_1`, {
      headers: EXTERN,
    });
    assert.equal(ret.status, HTTP_FORBIDDEN, "extern: GET /api/billing/checkout-return");
    keineBasicChallenge(ret, "GET /api/billing/checkout-return");
    assert.doesNotMatch(srv.stdout, /session_id/, "keine session_id in der Audit-Zeile");
    assert.doesNotMatch(srv.stdout, /cs_1/, "kein cs_1 in der Audit-Zeile");

    const setupLocal = await fetch(`${srv.localUrl}/api/billing/setup-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(setupLocal.status, HTTP_NOT_FOUND);
    assert.match((await setupLocal.json()).error, /PAYMENT_ENABLED/);

    const retLocal = await fetch(`${srv.localUrl}/api/billing/checkout-return?session_id=cs_1`);
    assert.equal(retLocal.status, HTTP_NOT_FOUND);
    assert.match((await retLocal.json()).error, /PAYMENT_ENABLED/);
  } finally {
    await srv.stop();
  }
});
