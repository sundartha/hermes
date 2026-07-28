// P15b/C2 - der Server loest das Anzeigeformat aus DERSELBEN Quelle auf wie die Sprache.
//
// Wurzel (P9/WEB-01): die Oberflaeche bekommt ihre Sprache vom Server. Das Format folgt
// DERSELBEN Aufloesung - eine zweite Praezedenz im Client (navigator.language, eigenes
// Mapping) wuerde beim Sprachwechsel auseinanderfallen. Was hier bleibt, ist der
// SERVER-VERTRAG: GET /api/self-service/state liefert formatLocale, und zwar exakt
// localeFor(language).dateLocale.
//
// P14: die frueheren Teile (a) Quelltext-Invariante von public/tenant.html und (c) der
// end-to-end-Feldnamen-Abgleich gegen genau diese Datei sind ENTFALLEN - das alte
// Dashboard ist geloescht. Damit hat formatLocale heute KEINEN Konsumenten: apps/web
// formatiert bewusst en-US (WEB-18, test/dashboard-i18n-surface.test.js). Das Feld bleibt
// im Vertrag (Entfernen waere ein eigener Vertragsschnitt), der Test haelt es stabil.
//
// Harness wie test/f2-self-service-state-private-number.test.js: reines pglite +
// Express, offline, KEIN Server-Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { localeFor } from "../src/i18n/locales.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "p15-date-locale-secret-0123456789";
const TENANTS = Object.freeze([
  { sub: "sub-de", tenantId: "t_sub-de", language: "de", formatLocale: "de-DE" },
  { sub: "sub-en", tenantId: "t_sub-en", language: "en", formatLocale: "en-GB" },
]);

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

async function seedActiveTenant(store, accounts, { sub, tenantId, language }) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Kunde", lastName: sub });
  const tenant = s.tenants.find((x) => x.id === tenantId);
  tenant.status = "active";
  tenant.idpSubject = sub;
  // Sprache am Tenant statt am Weltdefault: der Fall waehlt sein Szenario explizit.
  ops.setTenantGeo(s, tenantId, { defaultLanguage: language });
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

  const cookies = {};
  for (const tenant of TENANTS) {
    await seedActiveTenant(store, accounts, tenant);
    const { id } = await sessions.create({
      sub: tenant.sub,
      tenantId: tenant.tenantId,
      ttlSeconds: 3600,
    });
    cookies[tenant.tenantId] = cookieFor(id);
  }

  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw: webAuth({ secret: SECRET, sessions, accounts }),
      webAuthPendingMw: webAuthAllowPending({ secret: SECRET, sessions, accounts }),
      audit: () => {},
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
    cookies,
    close: () => new Promise((r) => server.close(r)),
  };
}

function getState(s, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${s.base}/api/self-service/state`);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "GET",
        headers: { Cookie: cookie },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("P15b/C2: /api/self-service/state liefert formatLocale = localeFor(language).dateLocale", async () => {
  const s = await setup();
  try {
    for (const tenant of TENANTS) {
      const res = await getState(s, s.cookies[tenant.tenantId]);
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.language, tenant.language, `${tenant.tenantId}: aufgeloeste Sprache`);
      assert.equal(
        body.formatLocale,
        localeFor(body.language).dateLocale,
        `${tenant.tenantId}: formatLocale stammt aus DERSELBEN Aufloesung wie language`,
      );
      assert.equal(body.formatLocale, tenant.formatLocale, `${tenant.tenantId}: konkreter Wert`);
    }
  } finally {
    await s.close();
  }
});
