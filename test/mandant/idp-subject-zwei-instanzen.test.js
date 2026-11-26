import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { makeOnboardRoutes } from "../../src/routes/api-onboard.js";
import { tenantIdForSubject } from "../../src/begriffe/mandant.ts";
import { operatorAuthPassThrough } from "../operator-route-app.js";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";
const ZEILE_SQL = `SELECT idp_subject FROM tenant WHERE id = $1`;

function runnerFuer(db, vorQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(runner) {
  const speicher = makePgStoreMitSperre(runner);
  await speicher.init();
  return speicher;
}

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
await instanz(runnerFuer(gemeinsam));
let laufendeNummer = 0;

const konfiguration = withConfigNamespaces({
  ...OHNE_EL_ZUGANG,
  provisioningEnabled: false,
  geoEnabled: false,
  provisioningCountry: "DE",
  forceNumberCountry: "",
  maxNumbers: 10,
  maxNumbersPerTenant: 5,
});

async function zweiInstanzen(vorQuery) {
  laufendeNummer += 1;
  const sub = `sub-idp-${laufendeNummer}`;
  const tenant = tenantIdForSubject(sub);
  await gemeinsam.query(`INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')`, [tenant]);
  const a = await instanz(runnerFuer(gemeinsam));
  const b = await instanz(runnerFuer(gemeinsam, vorQuery));
  return { a, b, tenant, sub };
}

async function onboard(speicher, koerper) {
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: speicher,
      config: konfiguration,
      audit: () => {},
      provisioning: {},
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((fertig) => {
    const s = app.listen(0, "127.0.0.1", () => fertig(s));
  });
  try {
    return await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "DE", ...koerper }),
    });
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

const gespeichert = async (tenantId) => {
  const { rows } = await gemeinsam.query(ZEILE_SQL, [tenantId]);
  return rows[0].idp_subject;
};

test("Kriterium 1: die idp_subject von A steht nach den letzten Flushs beider Instanzen in der Zeile und eine neue Instanz findet den Mandanten", async () => {
  const { a, b, tenant, sub } = await zweiInstanzen();

  assert.equal((await onboard(a, { idpSubject: sub })).status, 200);
  await a.drainFlushes();
  a.save();
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal(await gespeichert(tenant), sub);
  const neu = await instanz(runnerFuer(gemeinsam));
  assert.equal(neu.resolveTenant(sub), tenant);
});

test("Kriterium 2: ein letzter Flush einer veralteten Instanz setzt die idp_subject nicht zurück", async () => {
  const { a, b, tenant, sub } = await zweiInstanzen();

  await onboard(a, { idpSubject: sub });
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal(await gespeichert(tenant), sub);
});

test("Kriterium 3: scheitert das gezielte Schreiben der idp_subject, steht der Fehler im Log und der Aufrufer bekommt keinen", async (t) => {
  const zustand = { kaputt: false };
  const { b, tenant, sub } = await zweiInstanzen((text) => {
    if (zustand.kaputt && /^UPDATE tenant SET idp_subject = /.test(text)) throw new Error("Datenbank weg");
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  const antwort = await onboard(b, { idpSubject: sub });
  await b.drainFlushes();

  assert.equal(antwort.status, 200);
  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
    ),
  );
  assert.equal(await gespeichert(tenant), null);
});

test("Kriterium 3: ein Onboarding ohne idpSubject schreibt keine idp_subject", async (t) => {
  const abfragen = [];
  const { b, tenant } = await zweiInstanzen((text) => abfragen.push(text));
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  const antwort = await onboard(b, { tenantId: tenant });
  await b.drainFlushes();

  assert.equal(antwort.status, 200);
  assert.equal(fehlerausgabe.mock.calls.length, 0);
  assert.equal(await gespeichert(tenant), null);
  assert.ok(!abfragen.some((text) => /SET idp_subject/.test(text)));
});
