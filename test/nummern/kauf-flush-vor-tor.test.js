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
const ANLEGEZEIT = "2026-11-25T10:00:00.000Z";
const ZEITGRENZE_MS = 120_000;
const MANDANT = "t_flush_vor_tor";
const E164 = "+12025550178";
const POOL_GROESSE = 4;
const KONTEXT = "SELECT set_config('app.current_tenant', $1, false)";
const ZAEHLEN = `SELECT (SELECT count(*)::int FROM number) AS nummern, (SELECT count(*)::int FROM provisioning_job) AS auftraege`;
const FLUSH_ANFANG = "INSERT INTO tenant (id, status";
const TOR_SPERRE = "SELECT id FROM tenant WHERE id = $1 FOR UPDATE";
const ABSCHLUSS = "COMMIT";

function runnerFuer(pool, vorQuery = async () => {}, nachQuery = async () => {}) {
  return {
    async withClient(arbeit) {
      const client = await pool.connect();
      try {
        return await arbeit({
          query: async (text, werte) => {
            await vorQuery(text, werte);
            const ergebnis = await client.query(text, werte);
            await nachQuery(text);
            return ergebnis;
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
  const eigene = zustand.numbers.filter((nummer) => nummer.tenantId === tenantId && lebend(nummer));
  if (eigene.length > 0) return { ok: false, fehler: "already_provisioned" };
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
  return { ok: true, wert: { number } };
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

const konfiguration = withConfigNamespaces({
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

function einmalig() {
  let freigeben;
  const erreicht = new Promise((aufgeloest) => {
    freigeben = aufgeloest;
  });
  return { erreicht, freigeben };
}

async function aufbau(t) {
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
    await client.query("INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, 'active', $1, 'US')", [MANDANT]);
  } finally {
    client.release();
  }
  const sql = async (text, werte = []) => {
    const abfrage = await start.connect();
    try {
      await abfrage.query(KONTEXT, [MANDANT]);
      return (await abfrage.query(text, werte)).rows;
    } finally {
      abfrage.release();
    }
  };
  const imSpeicher = [einmalig(), einmalig()];
  const flushFertig = [einmalig(), einmalig()];
  const alleImSpeicher = Promise.all(imSpeicher.map((marke) => marke.erreicht));
  const alleFlushFertig = Promise.all(flushFertig.map((marke) => marke.erreicht));
  const attrappe = anbieter();
  const haken = { scharf: false };
  const instanz = async (nummer) => {
    let imFlush = false;
    const vorQuery = async (text) => {
      if (!haken.scharf) return;
      if (text.startsWith(FLUSH_ANFANG)) {
        imFlush = true;
        await alleImSpeicher;
      }
      if (text === TOR_SPERRE) await alleFlushFertig;
    };
    const nachQuery = async (text) => {
      if (haken.scharf && imFlush && text === ABSCHLUSS) flushFertig[nummer].freigeben();
    };
    const store = makePgStoreMitSperre(runnerFuer(neuerPool(), vorQuery, nachQuery));
    await store.init();
    const orchestrator = makeProvisioningOrchestrator({
      store,
      config: konfiguration,
      queue: withConfigOverrides({ queueBackend: "memory" }, () => createQueue()),
      billing: {},
      metering: {},
      numberProvisioning: attrappe.numberProvisioning,
      handleProvisionJob,
      resolveProvisionRetry: (zustand, eingabe) => {
        const ergebnis = resolveProvisionRetry(zustand, eingabe);
        imSpeicher[nummer].freigeben();
        return ergebnis;
      },
      audit: () => {},
      recordProvisioningJob,
      markProvisioningJob,
      classifyQueuedProvisioningJobs,
      findNumber,
    });
    return { store, orchestrator };
  };
  return { instanz, attrappe, sql, haken };
}

async function ausloesenUndAbarbeiten({ store, orchestrator }) {
  store.save();
  const ergebnis = await orchestrator.triggerTenantProvisioning(MANDANT);
  await orchestrator.runProvisioningDrainExclusive();
  await store.drainFlushes();
  return ergebnis;
}

test(
  "Zwei Instanzen: ein vor der Nummernanlage eingereihter Flush schreibt die Nummer nicht vor der Mandantenprüfung in die Datenbank",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await aufbau(t);
    if (!umgebung) return;
    const a = await umgebung.instanz(0);
    const b = await umgebung.instanz(1);
    umgebung.haken.scharf = true;
    const ergebnisse = await Promise.all([ausloesenUndAbarbeiten(a), ausloesenUndAbarbeiten(b)]);
    assert.deepEqual(await umgebung.sql(ZAEHLEN), [{ nummern: 1, auftraege: 1 }]);
    assert.equal(umgebung.attrappe.bestellungen.length, 1);
    assert.equal(ergebnisse.filter((ergebnis) => ergebnis.reason === "queued").length, 1, JSON.stringify(ergebnisse));
    assert.equal(ergebnisse.filter((ergebnis) => ergebnis.reason === "already_provisioned").length, 1, JSON.stringify(ergebnisse));
  },
);
