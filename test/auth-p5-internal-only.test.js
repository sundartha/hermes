// AUTH-P5: internalOnly vor den sieben MCP-Routen + Audit-Ersatz an vier Stellen.
// Bis hierher war der Schutz dieser sieben Routen NUR ein Nebeneffekt des Basic-Auth-
// Gates (das mit P7 faellt). internalOnly macht die eigentliche Vertrauensgrenze
// explizit: genuin lokaler In-Process-Aufrufer (isTrustedLocalCaller, echter Loopback-
// Socket OHNE X-Forwarded-For) - dieselbe Grenze wie AUTH-P3, keine neue Trust-Idee.
//
// Testpraefix bewusst "AUTH-P5-N" (NICHT DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|
// PROMPT|UI|VOICE|WEB|WORLD-<Ziffer>): sonst landet die Datei still im test:gates-Lauf,
// wo Rot erlaubt ist und nichts meldet (Lehre catalog-id-prefix-misroutes-tests).
//
// AUTH-P5-1/-2/-3 messen internalOnly ueber echte Spawn-Server (Muster AUTH-P3):
// BASE_ENV.DASHBOARD_PASSWORD="" -> das Basic-Auth-Gate ist ABWESEND (makeAuthGate
// startet mit `if (!config.auth.dashboardPassword) return next();`), nicht umgangen -
// jeder 403-Fall prueft zusaetzlich assertGateAbsent (kein 401, kein www-authenticate).
//
// AUTH-P5-4/-5/-6 messen die drei Ablehnungszweige in web-auth.js direkt: eine winzige
// lokale Express-App (Muster mountAdmin in test/web-auth.test.js) statt eines vollen
// Server-Spawns, weil der Web-Login-Block bei STORE_BACKEND=json (Spawn-Default) gar
// nicht gemountet ist (src/app.js: sessionSecret && storeBackend === "pg"). req.path/
// req.originalUrl sind dabei ECHT (echter Express-Request) - der W9-Test misst die
// reale Semantik, kein handgebautes req-Objekt.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { webAuth, adminOnly, signValue } from "../src/web-auth.js";
import { TENANT_STATUS, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  startServer,
  seedState,
  seedCall,
  mcpPost,
  toolCall,
  readToolResult,
  waitForLog,
  captureConsole,
  assertGateAbsent,
} from "./helpers.js";

const SECRET = "auth-p5-web-secret-0123456789";
const SESSION_TTL_MS = 3600_000;

function countMatches(text, re) {
  return (text.match(new RegExp(re, "g")) || []).length;
}

// Regex-Sonderzeichen im Pfad neutralisieren (keiner der sieben Pfade traegt welche,
// aber die Funktion bleibt korrekt statt zufaellig richtig).
function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// EINE lokale Express-App mit einer Handler-Kette auf GET /api/probe (Muster
// mountAdmin, test/web-auth.test.js) - fuer AUTH-P5-4/-5/-6.
async function mountProbe(middlewares) {
  const app = express();
  app.get("/api/probe", ...middlewares, (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// === AUTH-P5-1: die sieben Routen weisen den externen Aufrufer ab =================

const ROUTEN = [
  { methode: "POST", pfad: "/api/calls", body: { to: "+4915112345678", objective: "Test" } },
  { methode: "POST", pfad: "/api/calls/call_p5/cancel" },
  { methode: "GET", pfad: "/api/calls/call_p5/consult" },
  { methode: "POST", pfad: "/api/calls/call_p5/consult/answer", body: { event_id: "evt_1", answers: ["x"] } },
  { methode: "GET", pfad: "/api/state" },
  { methode: "GET", pfad: "/api/calls/call_p5" },
  { methode: "GET", pfad: "/api/tenant-data/export" },
];

test("AUTH-P5-1: die sieben internalOnly-Routen weisen den externen Aufrufer ab (403), auditieren genau einmal und loesen keinen Seiteneffekt aus", async (t) => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({ calls: [seedCall({ id: "call_p5", status: "active" })] }),
  });
  try {
    for (const { methode, pfad, body } of ROUTEN) {
      await t.test(`${methode} ${pfad}`, async () => {
        const res = await fetch(`${srv.localUrl}${pfad}`, {
          method: methode,
          headers: {
            "X-Forwarded-For": "203.0.113.9",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });

        // a) Status + Gate-Abwesenheit + Fehlerkoerper
        assert.equal(res.status, 403);
        assertGateAbsent(res);
        const json = await res.json();
        assert.ok(json.error, "403-Body traegt eine Fehlermeldung");

        // b) genau EINE Audit-Zeile. Das grund=not_local-Suffix ist load-bearing: ohne
        // es waere path=/api/calls ein Praefix von path=/api/calls/call_p5/... und der
        // Zaehler faelschlich hoch.
        const auditRegex = `\\[audit\\] auth_failed ip=\\S+ path=${escapeForRegex(pfad)} grund=not_local`;
        assert.equal(countMatches(srv.stdout, auditRegex), 1, `Audit-Zeile fuer ${pfad} fehlt oder kommt mehrfach vor`);

        // c) kein Seiteneffekt: kein neuer Call, kein Statuswechsel des geseedeten Calls
        const store = srv.readStore();
        assert.equal(store.calls.length, 1, "kein neuer Call entstand");
        assert.equal(store.calls[0].status, "active", "der geseedete Call wurde nicht abgebrochen");
      });
    }
  } finally {
    await srv.stop();
  }
});

// === AUTH-P5-2: der In-Process-Pfad lebt (Pre-Mortem-Gegenprobe) ==================

test("AUTH-P5-2: der In-Process-MCP-Pfad ueber Loopback (ohne XFF) bleibt unveraendert offen", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({ calls: [seedCall({ id: "call_p5", status: "active" })] }),
  });
  try {
    const stateRes = await fetch(`${srv.localUrl}/api/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();
    assert.equal(state.agent.owner, "Jonas Beispiel");
    assert.equal(state.calls.length, 1);

    const callRes = await fetch(`${srv.localUrl}/api/calls/call_p5`);
    assert.equal(callRes.status, 200);

    const exportRes = await fetch(`${srv.localUrl}/api/tenant-data/export`);
    assert.equal(exportRes.status, 200);
    const exported = await exportRes.json();
    assert.equal(exported.tenantId, BOOTSTRAP_TENANT_ID);

    // direkter Beweis, dass internalOnly die MCP-Werkzeuge nicht toetet: list_calls
    // laeuft intern ueber GET /api/state.
    const mcpRes = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("list_calls"));
    const result = await readToolResult(mcpRes);
    assert.notEqual(result?.isError, true, `MCP-Tool lieferte einen Fehler: ${JSON.stringify(result)}`);

    // Gegenprobe: kein einziger not_local-Eintrag fuer diesen genuin lokalen Verkehr.
    assert.ok(!srv.stdout.includes("grund=not_local"), "Loopback ohne XFF darf internalOnly nie ausloesen");
  } finally {
    await srv.stop();
  }
});

// === AUTH-P5-3: W9 (PFLICHTTEST) - kein Query im Audit, echte Express-Semantik ====

test("AUTH-P5-3 (W9): der Audit-Eintrag von internalOnly traegt NIE den Query-String", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({ calls: [seedCall({ id: "call_p5", status: "active" })] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/state?session_id=XYZ&code=ABC`, {
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    assert.equal(res.status, 403);
    await waitForLog(srv, /\[audit\] auth_failed ip=\S+ path=\/api\/state grund=not_local/);
    assert.ok(!srv.stdout.includes("XYZ"), "OAuth-code darf nie im Log landen");
    assert.ok(!srv.stdout.includes("ABC"), "Stripe-session_id darf nie im Log landen");
    assert.ok(!srv.stdout.includes("session_id"), "auch der Query-Feldname selbst darf nicht im Log stehen");
  } finally {
    await srv.stop();
  }
});

// === AUTH-P5-4/-5/-6: die drei Web-Auth-Ablehnungen (echter Express-Request) ======

test("AUTH-P5-4 (W9): webAuth ohne Sitzungs-Cookie -> 401 grund=no_session, kein Query im Log", async () => {
  // resolveWebSession bricht VOR jedem sessions/accounts-Zugriff ab (kein Cookie ->
  // sofort null) - werfende Attrappen pinnen diese Kurzschluss-Reihenfolge zusaetzlich:
  // wuerden sie aufgerufen, wuerfe der Test statt still falsch zu messen.
  const throwing = () => {
    throw new Error("darf bei fehlendem Cookie nie aufgerufen werden");
  };
  const webAuthMw = webAuth({ secret: SECRET, sessions: { get: throwing }, accounts: { resolve: throwing } });
  const srv = await mountProbe([webAuthMw]);
  try {
    let res;
    const lines = await captureConsole(async () => {
      res = await fetch(`${srv.base}/api/probe?session_id=XYZ&code=ABC`);
    });
    assert.equal(res.status, 401);
    const treffer = lines.filter((line) => line.includes("[audit] auth_failed"));
    assert.equal(treffer.length, 1, "genau eine Audit-Zeile");
    assert.match(treffer[0], /path=\/api\/probe grund=no_session/);
    assert.ok(!treffer[0].includes("XYZ"));
    assert.ok(!treffer[0].includes("ABC"));
  } finally {
    await srv.close();
  }
});

test("AUTH-P5-5: webAuth mit gueltiger Sitzung, aber gesperrtem Tenant (closed) -> 403 grund=not_active", async () => {
  const sessions = {
    get: async () => ({
      invalidated_at: null,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      sub: "s1",
    }),
  };
  const accounts = {
    resolve: async () => ({
      tenantId: "t1",
      role: "member",
      email: "a@b.test",
      status: TENANT_STATUS.CLOSED,
    }),
  };
  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const srv = await mountProbe([webAuthMw]);
  try {
    const cookie = `session=${encodeURIComponent(signValue("sess_p5", SECRET))}`;
    let res;
    const lines = await captureConsole(async () => {
      res = await fetch(`${srv.base}/api/probe`, { headers: { Cookie: cookie } });
    });
    assert.equal(res.status, 403);
    const treffer = lines.filter((line) => line.includes("[audit] auth_failed"));
    assert.equal(treffer.length, 1, "genau eine Audit-Zeile");
    assert.match(treffer[0], /path=\/api\/probe grund=not_active/);
  } finally {
    await srv.close();
  }
});

test("AUTH-P5-6 (W9): adminOnly ohne Admin-Rechte -> 403 grund=not_admin, kein Query im Log", async () => {
  const setTenant = (req, _res, next) => {
    req.tenant = { role: "member", email: "a@b.test" };
    next();
  };
  const srv = await mountProbe([setTenant, adminOnly({ adminEmails: [] })]);
  try {
    let res;
    const lines = await captureConsole(async () => {
      res = await fetch(`${srv.base}/api/probe?session_id=XYZ&code=ABC`);
    });
    assert.equal(res.status, 403);
    const treffer = lines.filter((line) => line.includes("[audit] auth_failed"));
    assert.equal(treffer.length, 1, "genau eine Audit-Zeile");
    assert.match(treffer[0], /path=\/api\/probe grund=not_admin/);
    assert.ok(!treffer[0].includes("XYZ"));
    assert.ok(!treffer[0].includes("ABC"));
  } finally {
    await srv.close();
  }
});
