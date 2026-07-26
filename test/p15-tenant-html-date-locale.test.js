// P15/T1 - das Datums-/Zeitformat des Tenant-Dashboards folgt der Tenant-Sprache.
//
// Wurzel (P9/WEB-01): die Seite bekommt ihre Sprache bereits vom Server. Das Format folgt
// DERSELBEN Aufloesung - eine zweite Praezedenz im Client (navigator.language, eigenes
// Mapping) wuerde beim Sprachwechsel auseinanderfallen. Der Test haelt beides fest:
//   (a) Quelltext-Invariante von public/tenant.html (kein hartes "de-DE" auf der
//       Datums-/Zeit-Achse, GENAU EINE Zuweisungsstelle, kein navigator.language)
//   (b) Route-Invariante: GET /api/self-service/state liefert dateLocale, und zwar exakt
//       localeFor(language).dateLocale - der Client leitet NICHTS ab.
//
// Harness (b) wie test/f2-self-service-state-private-number.test.js: reines pglite +
// Express, offline, KEIN Server-Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { localeFor } from "../src/i18n/locales.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { ROOT } from "./helpers.js";

const SECRET = "p15-date-locale-secret-0123456789";
const TENANTS = Object.freeze([
  { sub: "sub-de", tenantId: "t_sub-de", language: "de", dateLocale: "de-DE" },
  { sub: "sub-en", tenantId: "t_sub-en", language: "en", dateLocale: "en-GB" },
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

const tenantHtml = () => fs.readFileSync(path.join(ROOT, "public/tenant.html"), "utf8");

test("T1 (a): public/tenant.html formatiert Datum/Zeit nicht mehr hart auf de-DE", () => {
  const src = tenantHtml();
  assert.doesNotMatch(src, /toLocaleString\("de-DE"\)/, "kein hartes de-DE im Zeitstempel");
  assert.doesNotMatch(src, /toLocaleDateString\("de-DE"\)/, "kein hartes de-DE im Datum");
});

test("T1 (a): genau EINE Zuweisungsstelle fuer dateLocale, keine zweite Sprachquelle im Client", () => {
  const src = tenantHtml();
  assert.doesNotMatch(src, /navigator\.language/, "der Client leitet die Sprache NICHT selbst ab");
  // Zuweisungen an dateLocale OHNE die Deklaration (`let dateLocale = ...`) und ohne
  // Vergleiche (`==`): uebrig bleibt genau der eine Schreibzugriff in setDateLocale.
  const assignments = src.match(/(?<!let\s)\bdateLocale\s*=(?!=)/g) || [];
  assert.equal(assignments.length, 1, "nur setDateLocale schreibt den Wert");
});

test("T1 (b): /api/self-service/state liefert dateLocale = localeFor(language).dateLocale", async () => {
  const s = await setup();
  try {
    for (const tenant of TENANTS) {
      const res = await getState(s, s.cookies[tenant.tenantId]);
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.language, tenant.language, `${tenant.tenantId}: aufgeloeste Sprache`);
      assert.equal(
        body.dateLocale,
        localeFor(body.language).dateLocale,
        `${tenant.tenantId}: dateLocale stammt aus DERSELBEN Aufloesung wie language`,
      );
      assert.equal(body.dateLocale, tenant.dateLocale, `${tenant.tenantId}: konkreter Wert`);
    }
  } finally {
    await s.close();
  }
});
