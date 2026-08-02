// AUTH-P7: das Basic-Auth-Gate ist entfernt - jede Route traegt ihre eigene Sicherung.
// Diese Datei ist der Detektor fuer eine Wiederauferstehung: jeder Spawn setzt
// DASHBOARD_PASSWORD auf einen NICHT-leeren Wert und ruft mit X-Forwarded-For (statt
// externalUrl - dann wird nie geskippt). Genau diese Kombination lieferte vor P7
// ueberall 401 + Basic-Challenge. Kehrt das Gate je zurueck, werden AUTH-P7-1/-2/-4
// sofort rot - das ist zugleich die inhaltliche Rechtfertigung dafuer, dass
// DASHBOARD_PASSWORD in src/config.js stehen bleibt (Rollback-Sicherung, s. AUTH-P8).
//
// Testpraefix bewusst "AUTH-P7-N" (NICHT DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|
// PROMPT|UI|VOICE|WEB|WORLD-<Ziffer>): sonst landet die Datei still im test:gates-Lauf,
// wo Rot erlaubt ist und nichts meldet (Lehre catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, waitForLog, startIdp } from "./helpers.js";
import { LOGIN_ALIAS_PATHS, APP_ALIAS_PATHS } from "../src/portal-paths.js";

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

// GATE_DETEKTOR: ein nicht-leerer Wert ist der Zustand, in dem vor AUTH-P7 JEDE Route
// hinter dem Gate 401 + Basic-Challenge lieferte. EXTERN: X-Forwarded-For schlaegt
// isTrustedLocalCaller fehl, unabhaengig vom Socket - simuliert einen Aufrufer hinter
// dem Render-Proxy, ohne externalUrl (und damit ohne den externalIp()-Skip) zu brauchen.
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
    // Negativkontrolle: eine in AUTH-P4 geloeschte Route bleibt 404, nicht 401.
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
    // Vollstaendigkeits-Assertion gegen ein stilles Wachsen der Alias-Listen.
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
    // Negativproben: kein Login-Formular (GET-only), keine Beschattung von /api/admin/*.
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
  // MCP_AUTH=oauth (Muster test/oauth.test.js, lokaler Mini-IdP): nur verifyOauth
  // setzt die RFC-9728-Bearer-Challenge (deny401 in src/auth.js); der Legacy-
  // Bearer-Pfad (MCP_AUTH_TOKEN) tut das nicht. Ausserdem verlangt oauth den Bearer
  // IMMER, unabhaengig vom Loopback-Bypass - sonst liesse der lokale Test-Spawn
  // (echter Loopback-Socket) POST /mcp ungeprueft durch.
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
    // B-1: die RFC-9728-Bearer-Challenge von mcpAuth MUSS ueberleben - sie ist die
    // Discovery-Naht des Claude-Connectors, kein Basic-Auth-Rest.
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
    // Absolute Regel 4/W9: die Audit-Zeile traegt NIE den Query-String.
    assert.doesNotMatch(srv.stdout, /session_id/, "keine session_id in der Audit-Zeile");
    assert.doesNotMatch(srv.stdout, /cs_1/, "kein cs_1 in der Audit-Zeile");

    // Lokal ohne X-Forwarded-For: internalOnly laesst durch, PAYMENT_ENABLED (aus,
    // BASE_ENV-Default) antwortet dahinter mit 404 - der Beweis, dass internalOnly
    // VOR dem Payment-Gate laeuft und den In-Process-Pfad nicht angreift.
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

  // Positiv-Assertion: WWW-Authenticate darf NUR noch in src/auth.js vorkommen (die
  // Bearer-Challenge von mcpAuth, B-1) - waere sie geloescht, wuerde diese Assertion
  // rot statt stillschweigend gruen zu bleiben.
  const wwwAuthTreffer = files
    .filter((f) => /WWW-Authenticate/.test(contentsByFile.get(f)))
    .map((f) => path.relative(SRC_ROOT, f))
    .sort();
  assert.deepEqual(wwwAuthTreffer, ["auth.js"]);
});
