// P2a (Messbarkeit: Ergebnisse sichtbar) - GET /api/self-service/state liefert jetzt
// den Meldungs-Feed (notifications) UND die Kartenrumpf-Datenbasis (summary/
// objectiveAchieved) ueberlebt publicCall. Kompositions-Integrationstest nach dem
// Muster f2-self-service-state-private-number.test.js: reines pglite (offline,
// F.I.R.S.T.), KEIN Server-Spawn. Prueft die SICHERHEITS-Invarianten der Lese-Sicht:
//   - eigene Notifications erscheinen (Datenkontrakt der UI)
//   - NIE die Notification eines fremden Tenants (H3-Scope)
//   - summary + objectiveAchieved ueberleben publicCall (streamToken bleibt draussen)
//   - kein Cookie -> 401, kein Notification-Body im Response
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "self-service-web-secret-0123456789";
const SUB_A = "sub-a";
const TENANT_A = "t_sub-a";
const SUB_B = "sub-b";
const TENANT_B = "t_sub-b";

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

async function seedActiveTenant(store, accounts, { sub, tenantId }) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Kunde", lastName: sub });
  const t = s.tenants.find((x) => x.id === tenantId);
  t.status = "active";
  t.idpSubject = sub;
  await accounts.upsertOnFirstLogin({ sub, email: `${sub}@kunde.de` });
  await accounts.setStatus(tenantId, "active");
}

async function setup() {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  await seedActiveTenant(store, accounts, { sub: SUB_A, tenantId: TENANT_A });
  await seedActiveTenant(store, accounts, { sub: SUB_B, tenantId: TENANT_B });
  const { id: sessionA } = await sessions.create({
    sub: SUB_A,
    tenantId: TENANT_A,
    ttlSeconds: 3600,
  });
  const { id: sessionB } = await sessions.create({
    sub: SUB_B,
    tenantId: TENANT_B,
    ttlSeconds: 3600,
  });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const audit = () => {};
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit,
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      provision: async () => {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    cookieA: cookieFor(sessionA),
    cookieB: cookieFor(sessionB),
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(method, url, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
const getState = (s, cookie = s.cookieB) =>
  request("GET", `${s.base}/api/self-service/state`, { cookie });

// Build-Helper (P13): legt einen beendeten Call mit Summary + Ziel-Bewertung samt
// zugehoeriger Notification im Mirror an und liefert den Call zurueck. Direkt ueber
// ops.createCall (wie i9-self-service.test.js) statt store.createCall - so bleibt
// die Referenz auf dasselbe Objekt fuer die Folge-Mutationen (summary/objectiveAchieved/
// status) erhalten, ein einziges store.save() am Ende genuegt.
function seedFinishedCall(store, { tenantId, summary, objectiveAchieved, notificationTitle }) {
  const call = ops.createCall(store.load(), {
    direction: "outbound",
    from: "+491701234000",
    to: "+491701234999",
    tenantId,
  });
  call.summary = summary;
  call.objectiveAchieved = objectiveAchieved;
  call.status = "completed";
  store.addNotification(notificationTitle, `${summary}`, call.id);
  store.save();
  return call;
}

test("P2a-1: /api/self-service/state liefert die Notifications des eigenen Tenants", async () => {
  const s = await setup();
  try {
    const call = seedFinishedCall(s.store, {
      tenantId: TENANT_B,
      summary: "Termin fuer naechsten Dienstag vereinbart.",
      objectiveAchieved: true,
      notificationTitle: "Anruf beendet",
    });
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.notifications), "notifications ist ein Array");
    const found = body.notifications.find((n) => n.callId === call.id);
    assert.ok(found, "die geseedete Notification muss auftauchen");
    assert.equal(found.title, "Anruf beendet");
    assert.equal(found.body, "Termin fuer naechsten Dienstag vereinbart.");
    assert.equal(typeof found.at, "string");
    assert.ok(found.at.length > 0);
  } finally {
    await s.close();
  }
});

test("P2a-2: NIE die Notification eines fremden Tenants (H3-Scope)", async () => {
  const s = await setup();
  try {
    seedFinishedCall(s.store, {
      tenantId: TENANT_A,
      summary: "A's vertrauliches Anliegen.",
      objectiveAchieved: false,
      notificationTitle: "A-exklusive Meldung",
    });
    const bCall = seedFinishedCall(s.store, {
      tenantId: TENANT_B,
      summary: "B's Anliegen.",
      objectiveAchieved: true,
      notificationTitle: "B-Meldung",
    });
    const res = await getState(s, s.cookieB); // eingeloggt als B
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(
      body.notifications.every((n) => n.callId === bCall.id),
      "kein fremder callId in B's Notification-Liste",
    );
    assert.equal(res.body.includes("A-exklusive Meldung"), false, "A's Titel NIE im B-Body");
    assert.equal(res.body.includes("A's vertrauliches Anliegen"), false, "A's Text NIE im B-Body");
  } finally {
    await s.close();
  }
});

test("P2a-3: summary + objectiveAchieved ueberleben publicCall (Datenvertrag der UI)", async () => {
  const s = await setup();
  try {
    seedFinishedCall(s.store, {
      tenantId: TENANT_B,
      summary: "Ruecktritt vom Vertrag angekuendigt.",
      objectiveAchieved: true,
      notificationTitle: "Anruf beendet",
    });
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.calls[0].summary, "Ruecktritt vom Vertrag angekuendigt.");
    assert.equal(body.calls[0].objectiveAchieved, true);
    // Gegenprobe: publicCall strippt weiterhin streamToken (kein Regress durch P2a).
    assert.equal("streamToken" in body.calls[0], false);
  } finally {
    await s.close();
  }
});

test("P2a-4: ohne Session-Cookie kein Notification-Body (fail-closed)", async () => {
  const s = await setup();
  try {
    seedFinishedCall(s.store, {
      tenantId: TENANT_B,
      summary: "Vertraulicher Gespraechsinhalt.",
      objectiveAchieved: true,
      notificationTitle: "Anruf beendet",
    });
    const res = await request("GET", `${s.base}/api/self-service/state`);
    assert.equal(res.status, 401);
    assert.equal(res.body.includes("Vertraulicher Gespraechsinhalt"), false, "kein Leak ohne Session");
  } finally {
    await s.close();
  }
});
