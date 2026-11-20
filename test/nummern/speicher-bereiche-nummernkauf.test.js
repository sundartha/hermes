import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";

const JETZT_MS = Date.parse("2026-11-14T08:00:00.000Z");
const JETZT_ISO = "2026-11-14T08:00:00.000Z";
const GRUND = "needs_manual_reconcile";
const CODE = "provision-retry:t_nk";
const TENANT = "t_nk";

async function aufbau() {
  const { store, db } = await makePgTestStore();
  store.load().tenants.push({ id: TENANT, status: "active", firstName: "Kunde", ownerName: "Kunde Nk" });
  const speicherungen = [];
  const echtesSave = store.save;
  store.save = (...args) => {
    speicherungen.push("save");
    return echtesSave.apply(store, args);
  };
  return { store, db, speicherungen, bereiche: speicherBereiche(store) };
}

async function mikroaufgaben() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function markerVon(db) {
  const { rows } = await db.query(
    `SELECT last_seen_at, closed_at FROM outage_alert WHERE code = $1 ORDER BY first_seen_at`,
    [CODE],
  );
  return rows.map((zeile) => ({
    lastSeenAt: zeile.last_seen_at.toISOString(),
    closedAt: zeile.closed_at ? zeile.closed_at.toISOString() : null,
  }));
}

function festhalten(store) {
  let freigeben;
  const gehalten = new Promise((aufloesen) => {
    freigeben = aufloesen;
  });
  const sperre = store.withStoreLock(() => gehalten);
  return { freigeben, sperre };
}

test("nummernkauf: ensureTenant reicht die Kennung weiter und liefert ein Promise", async () => {
  const aufrufe = [];
  const antwort = speicherBereiche({ ensureTenant: async (id) => aufrufe.push(id) }).nummernkauf.ensureTenant("t_1");
  assert.ok(antwort instanceof Promise);
  await antwort;
  assert.deepEqual(aufrufe, ["t_1"]);
});

test("nummernkauf: alleMandantenIds liefert die Kennungen aller Mandanten in der Reihenfolge des Zustands", async () => {
  const speicher = { load: () => ({ tenants: [{ id: "t_b" }, { id: "t_a" }] }) };
  const antwort = speicherBereiche(speicher).nummernkauf.alleMandantenIds();
  assert.ok(antwort instanceof Promise);
  assert.deepEqual(await antwort, ["t_b", "t_a"]);
});

test("nummernkauf: markTenantNeedsManualReconcile setzt den Grund und speichert nur bei Aenderung", async () => {
  const { store, bereiche, speicherungen } = await aufbau();
  const antwort = bereiche.nummernkauf.markTenantNeedsManualReconcile(TENANT);
  assert.ok(antwort instanceof Promise);
  assert.equal(await antwort, undefined);
  const mandant = store.load().tenants.find(({ id }) => id === TENANT);
  assert.equal(mandant.numberProvisionSkipReason, GRUND);
  assert.deepEqual(speicherungen, ["save"]);
  await bereiche.nummernkauf.markTenantNeedsManualReconcile(TENANT);
  await bereiche.nummernkauf.markTenantNeedsManualReconcile("t_unbekannt");
  assert.deepEqual(speicherungen, ["save"]);
});

test("nummernkauf: markTenantNeedsManualReconcile wartet auf die Speicher-Sperre", async () => {
  const { store, bereiche } = await aufbau();
  const { freigeben, sperre } = festhalten(store);
  const antwort = bereiche.nummernkauf.markTenantNeedsManualReconcile(TENANT);
  await mikroaufgaben();
  const mandant = store.load().tenants.find(({ id }) => id === TENANT);
  assert.notEqual(mandant.numberProvisionSkipReason, GRUND);
  freigeben();
  await sperre;
  await antwort;
  assert.equal(mandant.numberProvisionSkipReason, GRUND);
});

test("ausfall: beanspruchMarker legt den Marker an, wenn faellig, und schreibt ihn in die Tabelle", async () => {
  const { db, bereiche } = await aufbau();
  const gesehen = [];
  const antwort = bereiche.ausfall.beanspruchMarker({
    code: CODE,
    nowMs: JETZT_MS,
    istFaellig: (marker) => {
      gesehen.push(marker);
      return true;
    },
  });
  assert.ok(antwort instanceof Promise);
  assert.equal(await antwort, true);
  assert.deepEqual(gesehen, [undefined]);
  const marker = await markerVon(db);
  assert.equal(marker.length, 1);
  assert.equal(marker[0].lastSeenAt, JETZT_ISO);
  assert.equal(marker[0].closedAt, null);
});

test("ausfall: beanspruchMarker laesst den offenen Marker unveraendert, wenn nicht faellig", async () => {
  const { db, bereiche } = await aufbau();
  await bereiche.ausfall.beanspruchMarker({ code: CODE, nowMs: JETZT_MS - 60_000, istFaellig: () => true });
  const offen = await bereiche.ausfall.offenerMarker({ code: CODE });
  const gesehen = [];
  const ergebnis = await bereiche.ausfall.beanspruchMarker({
    code: CODE,
    nowMs: JETZT_MS,
    istFaellig: (marker) => {
      gesehen.push(marker);
      return false;
    },
  });
  assert.equal(ergebnis, false);
  assert.deepEqual(gesehen, [offen]);
  assert.notEqual(offen.lastSeenAt, JETZT_ISO);
  assert.deepEqual(await markerVon(db), [{ lastSeenAt: offen.lastSeenAt, closedAt: null }]);
});

test("ausfall: beanspruchMarker aktualisiert einen offenen Marker, wenn faellig, statt einen zweiten anzulegen", async () => {
  const { db, bereiche } = await aufbau();
  await bereiche.ausfall.beanspruchMarker({ code: CODE, nowMs: JETZT_MS - 60_000, istFaellig: () => true });
  await bereiche.ausfall.beanspruchMarker({ code: CODE, nowMs: JETZT_MS, istFaellig: () => true });
  const marker = await markerVon(db);
  assert.equal(marker.length, 1);
  assert.equal(marker[0].lastSeenAt, JETZT_ISO);
});

test("ausfall: beanspruchMarker uebergibt keinen geschlossenen Marker als offen", async () => {
  const { db, bereiche } = await aufbau();
  await bereiche.ausfall.beanspruchMarker({ code: CODE, nowMs: JETZT_MS - 60_000, istFaellig: () => true });
  await db.query(`UPDATE outage_alert SET closed_at = $2 WHERE code = $1`, [CODE, "2026-11-14T07:30:00.000Z"]);
  const gesehen = [];
  await bereiche.ausfall.beanspruchMarker({
    code: CODE,
    nowMs: JETZT_MS,
    istFaellig: (marker) => {
      gesehen.push(marker);
      return false;
    },
  });
  assert.deepEqual(gesehen, [undefined]);
});

test("ausfall: ein Wurf in der Pruefung wird zur Ablehnung, ohne eine Zeile zu schreiben", async (t) => {
  t.mock.method(console, "error", () => {});
  const { db, bereiche } = await aufbau();
  await assert.rejects(
    bereiche.ausfall.beanspruchMarker({
      code: CODE,
      nowMs: JETZT_MS,
      istFaellig: () => {
        throw new Error("kaputt");
      },
    }),
    /kaputt/,
  );
  assert.deepEqual(await markerVon(db), []);
});

test("Aufrufer: triggerTenantProvisioning legt den Mandanten ueber den Speicher-Bereich an", async () => {
  const { store } = await aufbau();
  const angelegt = [];
  const echtesEnsure = store.ensureTenant;
  store.ensureTenant = async (tenantId) => {
    angelegt.push(tenantId);
    return echtesEnsure.call(store, tenantId);
  };
  const audit = [];
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({ paymentEnabled: false, provisioningEnabled: false }),
    queue: {},
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: async () => ({}),
    resolveProvisionRetry: () => ({ ok: false, reason: "grund_nk" }),
    audit: (aktion, _akteur, detail) => audit.push([aktion, detail]),
    recordProvisioningJob: () => null,
    markProvisioningJob: () => null,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: () => null,
  });
  const ergebnis = await orchestrator.triggerTenantProvisioning(TENANT);
  assert.deepEqual(angelegt, [TENANT]);
  assert.deepEqual(ergebnis, { ok: false, reason: "grund_nk" });
  assert.deepEqual(audit, [["webhook_provision_skipped", `tenant=${TENANT} grund=grund_nk`]]);
});
