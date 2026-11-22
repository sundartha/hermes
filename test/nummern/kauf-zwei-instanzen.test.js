import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { randomUUID } from "node:crypto";

import { config as basisKonfiguration } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.ts";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.ts";
import { handleProvisionJob } from "../../src/worker/provisioning.ts";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { makeConfigOverrides } from "../helpers.js";
import { makePgStoreMitSperre } from "../pg-helpers.js";

const { withConfigOverrides } = makeConfigOverrides(basisKonfiguration);
const ANLEGEZEIT = "2026-11-21T10:00:00.000Z";
const ZEITGRENZE_MS = 120_000;
const MANDANT = "t_kauf_zwei";
const E164 = "+12025550177";
const POOL_GROESSE = 4;
const DREI = 3;
const KONTEXT = "SELECT set_config('app.current_tenant', $1, false)";
const ALTE_NUMMER = "INSERT INTO number (id, tenant_id, status) VALUES ($1, $2, $3)";
const NUMMERN_ZEILEN = "SELECT provider, status, country, language FROM number WHERE tenant_id = $1";
const SPERRE_ZEILE = "DELETE FROM tenant WHERE id = $1";
const ZAEHLEN = "SELECT (SELECT count(*)::int FROM number) AS nummern, (SELECT count(*)::int FROM provisioning_job) AS auftraege";

function runnerFuer(pool, vorQuery = () => {}) {
  return {
    async withClient(arbeit) {
      const client = await pool.connect();
      try {
        return await arbeit({
          query: async (text, werte) => {
            await vorQuery(text);
            return client.query(text, werte);
          },
          exec: (sql) => client.query(sql),
        });
      } finally {
        client.release();
      }
    },
  };
}

const lebend = (nummer) => nummer.status !== "released" && nummer.status !== "failed";
const findNumber = (zustand, id) => zustand.numbers.find((nummer) => nummer.id === id);
const classifyQueuedProvisioningJobs = () => ({ close: [], hold: [], redrive: [] });

function recordProvisioningJob(zustand, { numberId, tenantId, idempotencyKey }) {
  const vorhanden = zustand.provisioningJobs.find((job) => job.idempotencyKey === idempotencyKey);
  if (vorhanden) return vorhanden;
  const job = {
    id: `job_${randomUUID()}`,
    numberId,
    tenantId,
    kind: "provision_number",
    status: "queued",
    idempotencyKey,
    attempts: 0,
    lastError: null,
    createdAt: ANLEGEZEIT,
  };
  zustand.provisioningJobs.push(job);
  return job;
}

function markProvisioningJob(zustand, id, status) {
  Object.assign(zustand.provisioningJobs.find((job) => job.id === id), { status });
}

function resolveProvisionRetry(zustand, { tenantId }) {
  const mandant = zustand.tenants.find((eintrag) => eintrag.id === tenantId);
  if (mandant?.status !== "active") return { ok: false, reason: "tenant_inactive" };
  const eigene = zustand.numbers.filter((nummer) => nummer.tenantId === tenantId && lebend(nummer));
  const haengend = eigene.find((nummer) => nummer.status === "requested");
  const job = zustand.provisioningJobs.find((eintrag) => eintrag.numberId === haengend?.id && eintrag.status === "queued");
  if (job) return { ok: true, reason: "redrive", numberId: haengend.id, jobId: job.id, job };
  if (eigene.length > 0) return { ok: false, reason: "already_provisioned" };
  const number = {
    id: `num_${randomUUID()}`,
    e164: null,
    tenantId,
    provider: "telnyx",
    country: "US",
    language: "en",
    status: "requested",
    providerNumberId: null,
    paymentIntentId: null,
  };
  zustand.numbers.push(number);
  return { ok: true, number };
}

function anbieter() {
  const bestellungen = [];
  return {
    bestellungen,
    numberProvisioning: () => ({
      searchNumbers: async () => [{ e164: E164 }],
      orderNumber: async ({ e164 }) => {
        bestellungen.push(e164);
        return { e164, providerNumberId: `pn_${bestellungen.length}` };
      },
    }),
  };
}

const konfig = (aenderung = {}) => withConfigNamespaces({
  ...OHNE_EL_ZUGANG,
  paymentEnabled: false,
  provisioningEnabled: true,
  maxNumbers: 50,
  maxNumbersPerTenant: 1,
  provisioningRedriveMaxAgeMs: 3_600_000,
  geoEnabled: false,
  provisioningCountry: "US",
  forceNumberCountry: "",
  ...aenderung,
});
const konfiguration = konfig();

async function aufbau(t, { status = "active" } = {}) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return null;
  const pools = [];
  const neuerPool = () => {
    const pool = new pg.Pool({ connectionString: db.adresse, max: POOL_GROESSE });
    pool.on("error", () => {});
    pools.push(pool);
    return pool;
  };
  t.after(() => Promise.all(pools.map((pool) => pool.end())));
  const start = neuerPool();
  await makePgStoreMitSperre(runnerFuer(start)).init();
  const client = await start.connect();
  try {
    await client.query(KONTEXT, [MANDANT]);
    await client.query("INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, $2, $1, 'US')", [MANDANT, status]);
  } finally {
    client.release();
  }
  const attrappe = anbieter();
  const speicher = [];
  const instanz = async (query, konfig = konfiguration) => {
    const store = makePgStoreMitSperre(runnerFuer(neuerPool(), query));
    await store.init();
    speicher.push(store);
    const orchestrator = makeProvisioningOrchestrator({
      store,
      config: konfig,
      queue: withConfigOverrides({ queueBackend: "memory" }, () => createQueue()),
      billing: {},
      metering: {},
      numberProvisioning: attrappe.numberProvisioning,
      handleProvisionJob,
      resolveProvisionRetry,
      audit: () => {},
      recordProvisioningJob,
      markProvisioningJob,
      classifyQueuedProvisioningJobs,
      findNumber,
    });
    return { store, orchestrator };
  };
  const sql = async (text, werte = []) => {
    await Promise.all(speicher.map((store) => store.drainFlushes()));
    const abfrage = await start.connect();
    try {
      await abfrage.query(KONTEXT, [MANDANT]);
      return (await abfrage.query(text, werte)).rows;
    } finally {
      abfrage.release();
    }
  };
  const zaehlen = async () => (await sql(ZAEHLEN))[0];
  return { instanz, attrappe, zaehlen, sql };
}

const anzahlImSpeicher = ({ store }) => store.load().numbers.length;

async function ausloesenUndAbarbeiten(instanz) {
  const ergebnis = await instanz.orchestrator.triggerTenantProvisioning(MANDANT);
  await instanz.orchestrator.runProvisioningDrainExclusive();
  return ergebnis;
}

test("Gleichzeitiges Ausloesen auf zwei Instanzen ergibt eine Nummer, einen Auftrag und eine Bestellung", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const [a, b] = [await umgebung.instanz(), await umgebung.instanz()];
  const ergebnisse = await Promise.all([ausloesenUndAbarbeiten(a), ausloesenUndAbarbeiten(b)]);
  assert.deepEqual(ergebnisse.map((e) => e.ok).sort(), [false, true]);
  const abgelehnt = ergebnisse.find((e) => !e.ok);
  assert.deepEqual(abgelehnt, { ok: false, reason: "already_provisioned" });
  assert.deepEqual(await umgebung.zaehlen(), { nummern: 1, auftraege: 1 });
  assert.deepEqual(umgebung.attrappe.bestellungen, [E164]);
  assert.equal(anzahlImSpeicher(a) + anzahlImSpeicher(b), 1);
});

test("Gleichzeitiges Ausloesen auf drei Instanzen haelt die Nummerngrenze je Mandant", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const instanzen = [await umgebung.instanz(), await umgebung.instanz(), await umgebung.instanz()];
  assert.equal(instanzen.length, DREI);
  const ergebnisse = await Promise.all(instanzen.map(ausloesenUndAbarbeiten));
  assert.equal(ergebnisse.filter((e) => e.ok).length, 1);
  assert.deepEqual(await umgebung.zaehlen(), { nummern: 1, auftraege: 1 });
  assert.equal(umgebung.attrappe.bestellungen.length, 1);
});

test("Zweites Anlegen mit demselben Schluessel auf einer anderen Instanz liefert den bestehenden Auftrag", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(undefined, konfig({ provisioningEnabled: false }));
  const angelegt = await a.orchestrator.triggerTenantProvisioning(MANDANT);
  assert.deepEqual(angelegt, { ok: true, reason: "dry_run", numberId: angelegt.numberId });
  const b = await umgebung.instanz();
  const erster = await a.orchestrator.queueProvisioning(angelegt.numberId, MANDANT);
  const zweiter = await b.orchestrator.queueProvisioning(angelegt.numberId, MANDANT);
  assert.equal(erster.ok, true);
  assert.equal(erster.jobId, `job_${angelegt.numberId}`);
  assert.deepEqual(zweiter, { ok: true, jobId: erster.jobId });
  assert.deepEqual(await umgebung.zaehlen(), { nummern: 1, auftraege: 1 });
  assert.deepEqual(await umgebung.sql(NUMMERN_ZEILEN, [MANDANT]), [
    { provider: "telnyx", status: "requested", country: "US", language: "en" },
  ]);
  const erneut = await a.orchestrator.queueProvisioning(angelegt.numberId, MANDANT);
  assert.deepEqual(erneut, { ok: true, jobId: erster.jobId });
  const { provisioningJobs } = a.store.load();
  assert.deepEqual(provisioningJobs.map((job) => job.id), [erster.jobId]);
  const [uebernommen] = b.store.load().provisioningJobs;
  assert.deepEqual({ ...uebernommen, createdAt: typeof uebernommen.createdAt }, {
    id: erster.jobId,
    tenantId: MANDANT,
    numberId: angelegt.numberId,
    kind: "provision_number",
    status: "queued",
    idempotencyKey: `provision_${angelegt.numberId}`,
    attempts: 0,
    lastError: null,
    createdAt: "string",
  });
  assert.equal(new Date(uebernommen.createdAt).toISOString(), uebernommen.createdAt);
  await umgebung.zaehlen();
});

test("Lesefehler beim Pruefen der Nummern: kein Kauf, keine Nummer, keine Bestellung", { timeout: ZEITGRENZE_MS }, async (t) => {
  let ausfall = false;
  const fehlerzeilen = [];
  t.mock.method(console, "error", (...zeile) => fehlerzeilen.push(zeile.join(" ")));
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz((text) => {
    if (ausfall && /FROM number/.test(text)) throw new Error("Leseausfall");
  });
  ausfall = true;
  const ergebnis = await ausloesenUndAbarbeiten(a);
  assert.deepEqual(ergebnis, { ok: false, reason: "persist_error" });
  assert.deepEqual(await umgebung.zaehlen(), { nummern: 0, auftraege: 0 });
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
  const { numbers } = a.store.load();
  assert.deepEqual(numbers, []);
  assert.ok(fehlerzeilen.includes("[pg] nummernkauf fehlgeschlagen: Leseausfall"));
  ausfall = false;
  const danach = await a.orchestrator.triggerTenantProvisioning(MANDANT);
  assert.equal(danach.ok, true);
  assert.deepEqual(await umgebung.zaehlen(), { nummern: 1, auftraege: 1 });
});

test("Ein haengender Auftrag desselben Mandanten wird neu eingereiht statt eine zweite Nummer anzulegen", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const erste = await umgebung.instanz(undefined, konfig({ provisioningEnabled: false }));
  const angelegt = await erste.orchestrator.triggerTenantProvisioning(MANDANT);
  await erste.orchestrator.queueProvisioning(angelegt.numberId, MANDANT);
  const zweite = await umgebung.instanz();
  const ergebnis = await zweite.orchestrator.triggerTenantProvisioning(MANDANT);
  assert.equal(ergebnis.reason, "redrive");
  assert.equal(ergebnis.numberId, angelegt.numberId);
  assert.deepEqual(await umgebung.zaehlen(), { nummern: 1, auftraege: 1 });
});

test("Ein gesperrter Mandant bekommt keine Nummer", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t, { status: "closed" });
  if (!umgebung) return;
  const a = await umgebung.instanz();
  assert.deepEqual(await a.orchestrator.triggerTenantProvisioning(MANDANT), { ok: false, reason: "tenant_inactive" });
  assert.deepEqual(await umgebung.zaehlen(), { nummern: 0, auftraege: 0 });
});

test("Freigegebene und fehlgeschlagene Nummern zaehlen nicht gegen den Kauf, auch wenn die Instanz sie nicht kennt", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz();
  await umgebung.sql(ALTE_NUMMER, ["num_alt_frei", MANDANT, "released"]);
  await umgebung.sql(ALTE_NUMMER, ["num_alt_fehl", MANDANT, "failed"]);
  const ergebnis = await ausloesenUndAbarbeiten(a);
  assert.equal(ergebnis.ok, true);
  assert.deepEqual(umgebung.attrappe.bestellungen, [E164]);
  await umgebung.zaehlen();
});

test("Eine bestehende Nummer einer anderen Instanz sperrt den Kauf in jedem lebenden Zustand", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz();
  await umgebung.sql(ALTE_NUMMER, ["num_alt_aktiv", MANDANT, "suspended"]);
  assert.deepEqual(await ausloesenUndAbarbeiten(a), { ok: false, reason: "already_provisioned" });
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
  assert.equal((await umgebung.zaehlen()).nummern, 1);
});

test("Fehlt der Mandant in der Datenbank, wird nichts gekauft", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz();
  await umgebung.sql(SPERRE_ZEILE, [MANDANT]);
  assert.deepEqual(await ausloesenUndAbarbeiten(a), { ok: false, reason: "persist_error" });
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
});

test("Die Grenze je Mandant gilt genau: eine lebende Nummer bei Grenze 2 sperrt den Kauf", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(undefined, konfig({ maxNumbersPerTenant: 2 }));
  await umgebung.sql(ALTE_NUMMER, ["num_alt_eins", MANDANT, "active"]);
  assert.deepEqual(await ausloesenUndAbarbeiten(a), { ok: false, reason: "already_provisioned" });
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
});

test("Die Grenze je Mandant gilt genau: zwei lebende Nummern bei Grenze 2 sperren den Kauf", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(undefined, konfig({ maxNumbersPerTenant: 2 }));
  await umgebung.sql(ALTE_NUMMER, ["num_alt_eins", MANDANT, "active"]);
  await umgebung.sql(ALTE_NUMMER, ["num_alt_zwei", MANDANT, "requested"]);
  assert.deepEqual(await ausloesenUndAbarbeiten(a), { ok: false, reason: "already_provisioned" });
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
});
