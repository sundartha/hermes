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
const KONTEXT = "SELECT set_config('app.current_tenant', $1, false)";
const ALTE_NUMMER = "INSERT INTO number (id, tenant_id, status) VALUES ($1, $2, $3)";
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



async function ausloesenUndAbarbeiten(instanz) {
  const ergebnis = await instanz.orchestrator.triggerTenantProvisioning(MANDANT);
  await instanz.orchestrator.runProvisioningDrainExclusive();
  return ergebnis;
}

const ZWEI = konfig({ maxNumbersPerTenant: 2 });

test("Grenze 2: eine lebende Nummer im Zustand capturing sperrt den Kauf", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(undefined, ZWEI);
  await umgebung.sql(ALTE_NUMMER, ["num_alt", MANDANT, "capturing"]);
  assert.deepEqual(await ausloesenUndAbarbeiten(a), { ok: false, reason: "already_provisioned" });
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
  assert.equal((await umgebung.zaehlen()).nummern, 1);
});
