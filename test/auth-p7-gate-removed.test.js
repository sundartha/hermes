import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, waitForLog, startIdp } from "./helpers.js";
import { LOGIN_ALIAS_PATHS, APP_ALIAS_PATHS } from "../src/portal-paths.js";

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

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
    assert.equal(res.status, 403);
    assert.notEqual(res.status, 401, "kein Gate mehr");
    assert.notEqual(res.status, 200, "200 waere der Datenleck-Fall - sofortiger Rollback");
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
      assert.equal(res.status, 404, pfad);
      keineBasicChallenge(res, `GET ${pfad}`);
    }
    const geloescht = await fetch(`${srv.localUrl}/api/settings`, {
      method: "POST",
      headers: { ...EXTERN, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(geloescht.status, 404, "POST /api/settings (P4 geloescht) bleibt 404");
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
      assert.equal(res.status, 302, von);
      assert.equal(res.headers.get("location"), ziel, von);
      keineBasicChallenge(res, `GET ${von}`);
    }
    const post = await fetch(`${srv.localUrl}/login`, { method: "POST", redirect: "manual" });
    assert.equal(post.status, 404, "POST /login bleibt 404 (GET-only)");
    const admin = await fetch(`${srv.localUrl}/api/admin/tenants`, {
      redirect: "manual",
      headers: EXTERN,
    });
    assert.notEqual(admin.status, 302, "/admin-Umleitung beschattet /api/admin/* nicht");
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
    assert.equal(intern.status, 403);
    assert.doesNotMatch(intern.headers.get("www-authenticate") ?? "", /^Basic/i, "GET /api/state");

    const fehlt = await fetch(`${srv.localUrl}/diese-route-gibt-es-nicht-12345`);
    assert.doesNotMatch(fehlt.headers.get("www-authenticate") ?? "", /^Basic/i, "GET /fehlt");

    const umleitung = await fetch(`${srv.localUrl}/login`, { redirect: "manual" });
    assert.doesNotMatch(umleitung.headers.get("www-authenticate") ?? "", /^Basic/i, "GET /login");

    const mcp = await fetch(`${srv.localUrl}/mcp`, { method: "POST" });
    assert.equal(mcp.status, 401);
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
    assert.equal(res.status, 200, "das gesetzte DASHBOARD_PASSWORD bewirkt nichts");
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
    assert.equal(setup.status, 403, "extern: POST /api/billing/setup-checkout");
    keineBasicChallenge(setup, "POST /api/billing/setup-checkout");
    await waitForLog(
      srv,
      /\[audit\] auth_failed ip=\S+ path=\/api\/billing\/setup-checkout grund=not_local/,
    );

    const ret = await fetch(`${srv.localUrl}/api/billing/checkout-return?session_id=cs_1`, {
      headers: EXTERN,
    });
    assert.equal(ret.status, 403, "extern: GET /api/billing/checkout-return");
    keineBasicChallenge(ret, "GET /api/billing/checkout-return");
    assert.doesNotMatch(srv.stdout, /session_id/, "keine session_id in der Audit-Zeile");
    assert.doesNotMatch(srv.stdout, /cs_1/, "kein cs_1 in der Audit-Zeile");

    const setupLocal = await fetch(`${srv.localUrl}/api/billing/setup-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(setupLocal.status, 404);
    assert.match((await setupLocal.json()).error, /PAYMENT_ENABLED/);

    const retLocal = await fetch(`${srv.localUrl}/api/billing/checkout-return?session_id=cs_1`);
    assert.equal(retLocal.status, 404);
    assert.match((await retLocal.json()).error, /PAYMENT_ENABLED/);
  } finally {
    await srv.stop();
  }
});

test("AUTH-P7-8: keine Wiederauferstehung im Quelltext", () => {
  function walk(root) {
    const out = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
    }
    return out;
  }
  const files = walk(SRC_ROOT);
  const contentsByFile = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

  const basicRealmTreffer = files.filter((f) => /basic realm/i.test(contentsByFile.get(f)));
  assert.deepEqual(basicRealmTreffer, [], "kein 'basic realm' mehr im Quelltext");

  const gateModulTreffer = files.filter((f) =>
    /makeAuthGate|installAuthGate|wiring\/auth-gate/.test(contentsByFile.get(f)),
  );
  assert.deepEqual(gateModulTreffer, [], "keine Referenz auf das geloeschte Gate-Modul mehr");

  const wwwAuthTreffer = files
    .filter((f) => /WWW-Authenticate/.test(contentsByFile.get(f)))
    .map((f) => path.relative(SRC_ROOT, f))
    .sort();
  assert.deepEqual(wwwAuthTreffer, ["auth.js", "middleware.js"]);
});
