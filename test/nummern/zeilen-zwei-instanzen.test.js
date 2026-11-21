import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { config as basisKonfiguration } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.js";
import { ersatzSpurEntfernen } from "../../src/store.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeConfigOverrides } from "../helpers.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const { withConfigOverrides } = makeConfigOverrides(basisKonfiguration);
const MANDANT = "t_zeilen_zwei";
const E164 = "+12025550178";
const ALT = "+12025550179";
const NEU = "+12025550180";
const LEER = { numbers: [], provisioningJobs: [] };
const NUMMERN = "SELECT id, e164, status FROM number ORDER BY id";
const AUFTRAEGE = "SELECT id, kind, idempotency_key FROM provisioning_job ORDER BY id";
const classifyQueuedProvisioningJobs = () => ({ close: [], hold: [], redrive: [] });
const findNumber = (zustand, id) => zustand.numbers.find((nummer) => nummer.id === id);
const konfig = withConfigNamespaces({
  ...OHNE_EL_ZUGANG,
  paymentEnabled: false,
  provisioningEnabled: true,
  maxNumbers: 50,
  maxNumbersPerTenant: 1,
  provisioningRedriveMaxAgeMs: 3_600_000,
  geoEnabled: false,
  provisioningCountry: "US",
  forceNumberCountry: "",
});

function runnerFuer(db, beobachte = () => {}) {
  return {
    withClient: (arbeit) =>
      arbeit({
        query: (text, werte) => {
          beobachte(text, werte);
          return db.query(text, werte);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

const kontext = (db) => db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);

async function lesen(db, text) {
  await kontext(db);
  return (await db.query(text)).rows;
}

async function neueInstanz(db, beobachte) {
  const store = makePgStoreMitSperre(runnerFuer(db, beobachte));
  await store.init();
  return store;
}

async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await kontext(db);
  await db.query("INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, 'active', $1, 'US')", [MANDANT]);
  return db;
}

function orchestratorFuer(store) {
  const bestellungen = [];
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: konfig,
    queue: withConfigOverrides({ queueBackend: "memory" }, () => createQueue()),
    billing: {},
    metering: {},
    numberProvisioning: () => ({
      searchNumbers: async () => [{ e164: E164 }],
      orderNumber: async ({ e164 }) => {
        bestellungen.push(e164);
        return { e164, providerNumberId: "pn_1" };
      },
    }),
    handleProvisionJob,
    resolveProvisionRetry: (zustand, { tenantId }) => {
      const nummer = { id: `num_${randomUUID()}`, e164: null, tenantId, provider: "telnyx", country: "US", language: "en", status: "requested", providerNumberId: null, paymentIntentId: null };
      zustand.numbers.push(nummer);
      return { ok: true, number: nummer };
    },
    audit: () => {},
    recordProvisioningJob: (zustand, { numberId, tenantId, idempotencyKey }) => {
      const job = { id: `job_${numberId}`, numberId, tenantId, kind: "provision_number", status: "queued", idempotencyKey, attempts: 0, lastError: null, createdAt: "2026-11-21T10:00:00.000Z" };
      zustand.provisioningJobs.push(job);
      return job;
    },
    markProvisioningJob: (zustand, id, status) => Object.assign(zustand.provisioningJobs.find((job) => job.id === id), { status }),
    classifyQueuedProvisioningJobs,
    findNumber,
  });
  return { orchestrator, bestellungen };
}

async function kaufenAufA(db) {
  const a = await neueInstanz(db);
  const { orchestrator } = orchestratorFuer(a);
  const ergebnis = await orchestrator.triggerTenantProvisioning(MANDANT);
  await orchestrator.runProvisioningDrainExclusive();
  await a.drainFlushes();
  return { a, ergebnis };
}

test("Eine Instanz mit veralteter Kopie loescht beim Flush weder Nummer noch Auftrag der anderen", async () => {
  const db = await aufbau();
  const b = await neueInstanz(db);
  assert.deepEqual([b.load().numbers, b.load().provisioningJobs], [[], []]);
  await kaufenAufA(db);
  const vorher = [await lesen(db, NUMMERN), await lesen(db, AUFTRAEGE)];
  assert.equal(vorher[0].length, 1);
  assert.equal(vorher[1].length, 1);
  b.save();
  await b.drainFlushes();
  assert.deepEqual([await lesen(db, NUMMERN), await lesen(db, AUFTRAEGE)], vorher);
});

test("Eine Instanz schreibt eine geaenderte Nummer und einen geaenderten Auftrag weiter beim Flush", async () => {
  const db = await aufbau();
  const { a } = await kaufenAufA(db);
  const nummer = a.load().numbers[0];
  const auftrag = a.load().provisioningJobs[0];
  nummer.status = "failed";
  auftrag.status = "failed";
  auftrag.attempts = 7;
  a.save();
  await a.drainFlushes();
  assert.deepEqual((await lesen(db, NUMMERN)).map((zeile) => zeile.status), ["failed"]);
  assert.deepEqual(await lesen(db, "SELECT status, attempts FROM provisioning_job"), [{ status: "failed", attempts: 7 }]);
});

test("Gibt eine Instanz ihre eigene unbezahlte Nummer zurueck, ist sie auch in der Datenbank weg", async () => {
  const db = await aufbau();
  const gesehen = [];
  const b = await neueInstanz(db, (text, werte) => {
    if (/^\s*DELETE FROM number\b/.test(text)) gesehen.push(werte);
  });
  await kaufenAufA(db);
  const { orchestrator, bestellungen } = orchestratorFuer(b);
  const abgelehnt = await orchestrator.triggerTenantProvisioning(MANDANT);
  assert.deepEqual(abgelehnt, { ok: false, reason: "already_provisioned" });
  assert.deepEqual(bestellungen, []);
  assert.equal(b.load().numbers.length, 0);
  assert.equal(gesehen.length, 1);
  assert.equal(gesehen[0][0], MANDANT);
  assert.match(gesehen[0][1], /^num_/);
  b.save();
  await b.drainFlushes();
  assert.equal((await lesen(db, NUMMERN)).length, 1);
});

test("Eine nach dem Anlegen zurueckgegebene Nummer verschwindet auch aus der Datenbank", async () => {
  const db = await aufbau();
  const b = await neueInstanz(db);
  const eingang = b.nummernSql();
  const nummer = { id: "num_zurueck", tenantId: MANDANT, provider: "telnyx", status: "requested", country: "US", language: "en" };
  assert.deepEqual(await eingang.nummerAnlegen({ tenantId: MANDANT, number: nummer, hoechstens: 2 }), { ok: true });
  assert.deepEqual((await lesen(db, NUMMERN)).map((zeile) => zeile.id), ["num_zurueck"]);
  await eingang.nummerEntfernen({ tenantId: MANDANT, numberId: "num_andere" });
  assert.equal((await lesen(db, NUMMERN)).length, 1);
  await eingang.nummerEntfernen({ tenantId: MANDANT, numberId: "num_zurueck" });
  assert.deepEqual(await lesen(db, NUMMERN), []);
});

test("Entfernt eine Instanz die Ersatz-Spur, ist der Auftrag in der Datenbank weg und die Nummern bleiben", async () => {
  const db = await aufbau();
  await kontext(db);
  await db.query("INSERT INTO number (id, tenant_id, e164, provider, status) VALUES ('num_alt', $1, $2, 'telnyx', 'active'), ('num_neu', $1, $3, 'telnyx', 'active')", [MANDANT, ALT, NEU]);
  await db.query("INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, created_at) VALUES ('job_spur', $1, 'num_neu', 'number_swap', 'done', 'tausch_num_alt', 1, now()), ('job_fremd', $1, 'num_alt', 'provision_number', 'done', 'provision_num_alt', 1, now())", [MANDANT]);
  const b = await neueInstanz(db);
  const ergebnis = ersatzSpurEntfernen(b.load(), { e164: NEU, alteE164: ALT, tenantId: MANDANT });
  assert.deepEqual(ergebnis, { ok: true, geaendert: true, auftragId: "job_spur" });
  await b.nummernSql().auftragEntfernen({ tenantId: MANDANT, jobId: ergebnis.auftragId });
  b.save();
  await b.drainFlushes();
  assert.deepEqual((await lesen(db, AUFTRAEGE)).map((zeile) => zeile.id), ["job_fremd"]);
  assert.deepEqual((await lesen(db, NUMMERN)).map((zeile) => zeile.id), ["num_alt", "num_neu"]);
  assert.deepEqual(ersatzSpurEntfernen(LEER, { e164: NEU, alteE164: ALT, tenantId: MANDANT }), { ok: false, grund: "alte_nummer_nicht_aktiv" });
});

test("Scheitert das Pruefen der Nummern und das Zurueckgeben, nennt der Fehler das Pruefen und die Kopie ist leer", async (t) => {
  const db = await aufbau();
  const b = await neueInstanz(db, (text) => {
    if (/count\(\*\)[\s\S]*FROM number/.test(text)) throw new Error("Leseausfall");
    if (/^\s*DELETE FROM number\b/.test(text)) throw new Error("Loeschausfall");
  });
  const { orchestrator, bestellungen } = orchestratorFuer(b);
  const fehlerzeilen = [];
  t.mock.method(console, "error", (...zeile) => fehlerzeilen.push(zeile.join(" ")));
  assert.deepEqual(await orchestrator.triggerTenantProvisioning(MANDANT), { ok: false, reason: "persist_error" });
  assert.ok(fehlerzeilen.includes("[webhook-provision] Persistenz fehlgeschlagen: Leseausfall"), fehlerzeilen.join("|"));
  assert.deepEqual(b.load().numbers, []);
  assert.deepEqual(bestellungen, []);
  assert.deepEqual(await lesen(db, NUMMERN), []);
});

test("Ein Flush ordnet neue Nummern und Auftraege zweier Mandanten jeweils ihrem eigenen Mandanten zu", async () => {
  const db = await aufbau();
  const zweiter = "t_zeilen_zwei_y";
  await db.query("INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, 'active', $1, 'US')", [zweiter]);
  const b = await neueInstanz(db);
  const zustand = b.load();
  for (const [tenantId, e164] of [[MANDANT, E164], [zweiter, NEU]]) {
    zustand.numbers.push({ id: `num_${tenantId}`, tenantId, e164, provider: "telnyx", status: "active", country: "US", language: "en" });
    zustand.provisioningJobs.push({ id: `job_${tenantId}`, numberId: `num_${tenantId}`, tenantId, kind: "provision_number", status: "done", idempotencyKey: `key_${tenantId}`, attempts: 1, lastError: null, createdAt: "2026-11-21T10:00:00.000Z" });
  }
  b.save();
  await b.drainFlushes();
  const wert = async (mandant, text) => {
    await db.query("SELECT set_config('app.current_tenant', $1, false)", [mandant]);
    return (await db.query(text)).rows;
  };
  assert.deepEqual(await wert(MANDANT, "SELECT id, tenant_id FROM number"), [{ id: `num_${MANDANT}`, tenant_id: MANDANT }]);
  assert.deepEqual(await wert(zweiter, "SELECT id, tenant_id FROM number"), [{ id: `num_${zweiter}`, tenant_id: zweiter }]);
  assert.deepEqual(await wert(MANDANT, "SELECT id, tenant_id FROM provisioning_job"), [{ id: `job_${MANDANT}`, tenant_id: MANDANT }]);
  assert.deepEqual(await wert(zweiter, "SELECT id, tenant_id FROM provisioning_job"), [{ id: `job_${zweiter}`, tenant_id: zweiter }]);
});
