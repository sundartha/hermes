import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { makeLeitungsplaetze, tenantPrivateNumberLesen } from "../../src/store.js";
import { makeCallRoutes } from "../../src/routes/api-calls.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { EL_OUTBOUND_CONFIG } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannDiAttrappe, vorspannKonfig, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const HTTP_OK = 200;
const TENANT = "T";
const ABSENDER = "+491700000000";
const NUMMER_ALT = "+4915100000001";
const NUMMER_NEU = "+4915100000002";
const AUFTRAG = "Tisch fuer zwei reservieren";
const AUFBEWAHRUNG_TAGE = 30;
const NICHT_LESBAR = /grund=eigene_nummer_nicht_lesbar/;
const NUMMER_LESEN = /private_number/;

const routenKonfig = (erlaubteMandanten) =>
  withConfigNamespaces({
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    platformSpendCapCents: 800,
    allowedCountryCodes: ["+49"],
    maxCallsPerHour: 100,
    perTargetWindowMs: 3600000,
    perTargetCallCap: 100,
    multiTenant: false,
    diagnosticRetentionDays: AUFBEWAHRUNG_TAGE,
    ownerSelfCallEnabled: true,
    ownerSelfCallTenantIds: erlaubteMandanten,
    ...vorspannKonfig([TENANT], EL_OUTBOUND_CONFIG),
    telnyxElevenLabs: {},
    telnyxAssistant: { enabled: false },
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
  });

const BUDGET_ALT = {
  PRECALL_BRIEFING_ENABLED: "false",
  ASSISTANT_CONTEXT_ENABLED: "false",
  IN_CALL_CONSULT_ENABLED: "false",
  CONSULT_ENABLED: "false",
  METRICS_ENABLED: "false",
};

async function instanz(db, nummernLesen) {
  const runner = {
    withClient: (fn) =>
      fn({
        query: async (text, params) => {
          if (NUMMER_LESEN.test(text) && !nummernLesen.an) throw new Error("private_number nicht lesbar");
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
  const store = makePgStoreMitSperre(runner);
  const { zustandsFunktionen } = await import("../../src/store.js");
  Object.assign(store, zustandsFunktionen(store));
  await store.init();
  return store;
}

async function zweiInstanzen({ vorhandeneNummer = null } = {}) {
  Object.assign(process.env, BUDGET_ALT);
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(db, { an: true });
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT]);
  await db.query(`INSERT INTO tenant (id, status) VALUES ($1, 'active')`, [TENANT]);
  const lesen = { an: true };
  const a = await instanz(db, { an: true });
  if (vorhandeneNummer) await nummerSpeichern(a, vorhandeneNummer);
  const b = await instanz(db, lesen);
  return { a, b, lesen };
}

function routeAuf(store, { erlaubt = [TENANT], audit }) {
  const tor = {
    name: "tenant",
    run(ctx) {
      Object.assign(ctx, {
        tenantId: TENANT,
        fromNumber: ABSENDER,
        outboundProvider: "telnyx",
        reserveCents: 60,
        maxDur: 60,
        requestedBy: "test",
      });
      return null;
    },
  };
  const beobachtet = {
    ...store,
    numberRecordByE164: (e164) => ({ e164, tenantId: TENANT, providerAgentPhoneNumberId: "phnum_vp" }),
    load: () => ({
      ...store.load(),
      numbers: [vorspannSeedNummer({ tenantId: TENANT, nummer: ABSENDER, registrierung: "phnum_vp" })],
    }),
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...vorspannDiAttrappe(),
      store: beobachtet,
      leitungsplaetze: makeLeitungsplaetze(),
      config: routenKonfig(erlaubt),
      audit,
      outboundGates: [tor],
      callQuotaDenial: () => null,
      voiceControl: () => ({ originateCall: async () => ({ sid: "sid_nummer" }), endCall: async () => {} }),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => TENANT, requireTenant: () => TENANT, tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  return app;
}

async function rufeAn(store, ziel, optionen = {}) {
  const meldungen = [];
  const app = routeAuf(store, { ...optionen, audit: (aktion, _req, detail) => meldungen.push(`${aktion} ${detail}`) });
  const server = await new Promise((fertig) => {
    const laufend = app.listen(0, "127.0.0.1", () => fertig(laufend));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: ziel, objective: AUFTRAG, diagnostic: true }),
    });
    const body = await antwort.json();
    return { status: antwort.status, call: store.getCall(body.callId), meldungen };
  } finally {
    server.closeAllConnections();
    await new Promise((fertig) => server.close(fertig));
  }
}

async function nummerSpeichern(store, nummer) {
  store.setPrivateNumber(TENANT, nummer);
  await store.drainFlushes();
}

test("Kriterium 1: eine Nummer, die A speichert, erkennt B als eigene, ohne die Kopie nachzuladen", async () => {
  const { a, b } = await zweiInstanzen();
  await nummerSpeichern(a, NUMMER_ALT);

  const ergebnis = await rufeAn(b, NUMMER_ALT);

  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(ergebnis.call.calleeIsOwner, true);
  assert.equal(ergebnis.call.diagnostic, true);
});

test("Kriterium 2: aendert A die eigene Nummer, ist die alte Nummer auf B kein Eigentuemer mehr", async () => {
  const { a, b } = await zweiInstanzen({ vorhandeneNummer: NUMMER_ALT });
  assert.equal(b.tenantPrivateNumber(TENANT), NUMMER_ALT, "Ausgangslage: die Kopie von B kennt die Nummer");
  await nummerSpeichern(a, NUMMER_NEU);

  const alt = await rufeAn(b, NUMMER_ALT);
  const neu = await rufeAn(b, NUMMER_NEU);

  assert.equal(alt.status, HTTP_OK);
  assert.equal(alt.call.calleeIsOwner, false);
  assert.equal(alt.call.diagnostic, false);
  assert.equal(neu.call.calleeIsOwner, true);
});

test("Kriterium 2: loescht A die eigene Nummer, ist die alte Nummer auf B kein Eigentuemer mehr", async () => {
  const { a, b } = await zweiInstanzen({ vorhandeneNummer: NUMMER_ALT });
  assert.equal(b.tenantPrivateNumber(TENANT), NUMMER_ALT, "Ausgangslage: die Kopie von B kennt die Nummer");
  await nummerSpeichern(a, null);

  const ergebnis = await rufeAn(b, NUMMER_ALT);

  assert.equal(ergebnis.call.calleeIsOwner, false);
});

test("Kriterium 3: ist die Nummer nicht lesbar, laeuft der Anruf mit vollem Satz, ohne Diagnose, mit Audit", async () => {
  const { a, b, lesen } = await zweiInstanzen();
  await nummerSpeichern(a, NUMMER_ALT);
  lesen.an = false;

  const ergebnis = await rufeAn(b, NUMMER_ALT);

  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(ergebnis.call.calleeIsOwner, false);
  assert.equal(ergebnis.call.diagnostic, false);
  assert.equal(ergebnis.meldungen.filter((meldung) => NICHT_LESBAR.test(meldung)).length, 1);
});

test("Kriterium 3: der Lesefehler steht mit Aktionsname im Audit und mit Praefix im Log", async () => {
  const { a, b, lesen } = await zweiInstanzen();
  await nummerSpeichern(a, NUMMER_ALT);
  lesen.an = false;
  const zeilen = [];
  const original = console.error;
  console.error = (...teile) => zeilen.push(teile);

  let ergebnis;
  try {
    ergebnis = await rufeAn(b, NUMMER_ALT);
  } finally {
    console.error = original;
  }

  const audit = ergebnis.meldungen.filter((meldung) => NICHT_LESBAR.test(meldung));
  assert.equal(audit.length, 1);
  assert.ok(audit[0].startsWith("place_call_eigene_nummer grund=eigene_nummer_nicht_lesbar tenant="));
  const log = zeilen.filter((teile) => String(teile[0]).includes("eigene Nummer nicht lesbar"));
  assert.equal(log.length, 1);
  assert.equal(log[0][0], "[place_call] eigene Nummer nicht lesbar:");
});

test("Kriterium 3: ist die Nummer lesbar, steht kein Lesefehler im Audit", async () => {
  const { a, b } = await zweiInstanzen();
  await nummerSpeichern(a, NUMMER_ALT);

  const ergebnis = await rufeAn(b, NUMMER_ALT);

  assert.deepEqual(ergebnis.meldungen.filter((meldung) => NICHT_LESBAR.test(meldung)), []);
});

test("Kriterium 4: ein Mandant ausserhalb der Allowlist bleibt kein Eigentuemer, auch mit gleicher Nummer", async () => {
  const { a, b } = await zweiInstanzen();
  await nummerSpeichern(a, NUMMER_ALT);

  const ergebnis = await rufeAn(b, NUMMER_ALT, { erlaubt: ["t_anderer"] });

  assert.equal(ergebnis.call.calleeIsOwner, false);
});

test("Kriterium 1: A liest die eigene Nummer sofort nach dem Speichern, auch ohne abgewartetes Schreiben", async () => {
  const { a } = await zweiInstanzen();

  a.setPrivateNumber(TENANT, NUMMER_ALT);

  assert.equal(await a.tenantPrivateNumberLesen(TENANT), NUMMER_ALT);
});

test("Kriterium 1: ein Mandant ohne Nummer liefert null", async () => {
  const { b } = await zweiInstanzen();

  assert.equal(await b.tenantPrivateNumberLesen(TENANT), null);
});

test("Kriterium 5: der JSON-Speicher liefert fuer einen unbekannten Mandanten null", async () => {
  assert.equal(await tenantPrivateNumberLesen("t_gibt_es_nicht"), null);
});
