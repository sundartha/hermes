import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { randomUUID } from "node:crypto";

import { config as basisKonfiguration } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { makeConfigOverrides } from "../helpers.js";
import { makePgStoreMitSperre } from "../pg-helpers.js";

const { withConfigOverrides } = makeConfigOverrides(basisKonfiguration);
const ANLEGEZEIT = "2026-11-21T10:00:00.000Z";
const ZEITGRENZE_MS = 120_000;
const MANDANT = "t_plattform_a";
const ANDERER = "t_plattform_b";
const FREMDER = "t_plattform_c";
const E164 = "+12025550177";
const POOL_GROESSE = 4;
const KONTEXT = "SELECT set_config('app.current_tenant', $1, false)";
const ALTE_NUMMER = "INSERT INTO number (id, tenant_id, status) VALUES ($1, $2, $3)";
const ALLE_NUMMERN = "SELECT count(*)::int AS anzahl FROM number";
const MIT_KENNUNG = "INSERT INTO number (id, tenant_id, status, e164) VALUES ($1, $2, $3, $4)";
const LEBEND_GESAMT = "SELECT nummern_lebend_gesamt($1) AS anzahl";
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
  maxNumbers: 1,
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
    for (const mandant of [MANDANT, ANDERER, FREMDER]) {
      await client.query(KONTEXT, [mandant]);
      await client.query("INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, $2, $1, 'US')", [mandant, status]);
    }
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
  const sql = async (text, werte = [], mandant = MANDANT) => {
    await Promise.all(speicher.map((store) => store.drainFlushes()));
    const abfrage = await start.connect();
    try {
      await abfrage.query(KONTEXT, [mandant]);
      return (await abfrage.query(text, werte)).rows;
    } finally {
      abfrage.release();
    }
  };
  const zaehlen = async () => (await sql(ZAEHLEN))[0];
  return { instanz, attrappe, zaehlen, sql, db };
}


const anzahlImSpeicher = ({ store }) => store.load().numbers.length;

async function ausloesen(instanz, mandant) {
  const ergebnis = await instanz.orchestrator.triggerTenantProvisioning(mandant);
  await instanz.orchestrator.runProvisioningDrainExclusive();
  return ergebnis;
}

const nummerAnlegen = (umgebung, id, status, mandant = ANDERER) => umgebung.sql(ALTE_NUMMER, [id, mandant, status], mandant);
const gebucht = async (umgebung) => {
  const je = await Promise.all([MANDANT, ANDERER, FREMDER].map((mandant) => umgebung.sql(ALLE_NUMMERN, [], mandant)));
  return je.reduce((summe, zeilen) => summe + zeilen[0].anzahl, 0);
};

test("Zwei Mandanten loesen gleichzeitig auf zwei Instanzen aus, Grenze 1: genau eine Nummer, eine Bestellung", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const [a, b] = [await umgebung.instanz(), await umgebung.instanz()];
  const ergebnisse = await Promise.all([ausloesen(a, MANDANT), ausloesen(b, ANDERER)]);
  assert.deepEqual(ergebnisse.map((e) => e.ok).sort(), [false, true]);
  assert.deepEqual(ergebnisse.find((e) => !e.ok), { ok: false, reason: "already_provisioned" });
  assert.equal(await gebucht(umgebung), 1);
  assert.deepEqual(umgebung.attrappe.bestellungen, [E164]);
  assert.equal(anzahlImSpeicher(a) + anzahlImSpeicher(b), 1);
});

test("Grenze 2: eine lebende Nummer eines fremden Mandanten, der Instanz unbekannt, laesst den Kauf zu", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(undefined, konfig({ maxNumbers: 2 }));
  await nummerAnlegen(umgebung, "num_fremd_eins", "active");
  const ergebnis = await ausloesen(a, MANDANT);
  assert.equal(ergebnis.ok, true);
  assert.deepEqual(umgebung.attrappe.bestellungen, [E164]);
  assert.equal(await gebucht(umgebung), 2);
});

test("Grenze 2: zwei lebende Nummern fremder Mandanten lehnen den Kauf ab", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(undefined, konfig({ maxNumbers: 2 }));
  await nummerAnlegen(umgebung, "num_fremd_eins", "active");
  await nummerAnlegen(umgebung, "num_fremd_zwei", "suspended", FREMDER);
  assert.deepEqual(await ausloesen(a, MANDANT), { ok: false, reason: "already_provisioned" });
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
  assert.equal(await gebucht(umgebung), 2);
  assert.deepEqual(a.store.load().numbers, []);
});

test("Freigegebene und fehlgeschlagene Nummern fremder Mandanten zaehlen nicht gegen die Plattformgrenze", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz();
  await nummerAnlegen(umgebung, "num_fremd_frei", "released");
  await nummerAnlegen(umgebung, "num_fremd_fehl", "failed", FREMDER);
  assert.equal((await ausloesen(a, MANDANT)).ok, true);
  assert.deepEqual(umgebung.attrappe.bestellungen, [E164]);
  assert.equal(await gebucht(umgebung), 3);
});

test("Eine Nummer im Status requested ohne Kennung eines fremden Mandanten zaehlt gegen die Plattformgrenze", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz();
  await nummerAnlegen(umgebung, "num_fremd_angefragt", "requested");
  assert.deepEqual(await ausloesen(a, MANDANT), { ok: false, reason: "already_provisioned" });
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
});

test("Der Zaehler folgt Statuswechsel und Loeschen der Nummer", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  await nummerAnlegen(umgebung, "num_zaehler", "requested");
  const anzahl = async () => (await umgebung.sql(LEBEND_GESAMT, [""]))[0].anzahl;
  assert.equal(await anzahl(), 1);
  await umgebung.sql("UPDATE number SET status = 'released' WHERE id = 'num_zaehler'", [], ANDERER);
  assert.equal(await anzahl(), 0);
  await umgebung.sql("UPDATE number SET status = 'active' WHERE id = 'num_zaehler'", [], ANDERER);
  assert.equal(await anzahl(), 1);
  assert.deepEqual(await umgebung.sql(LEBEND_GESAMT, ["num_zaehler"]), [{ anzahl: 0 }]);
  await umgebung.sql("DELETE FROM number WHERE id = 'num_zaehler'", [], ANDERER);
  assert.equal(await anzahl(), 0);
});

test("Faellt die Plattformzaehlung aus, wird nichts gekauft und die Nummer im Speicher zurueckgenommen", { timeout: ZEITGRENZE_MS }, async (t) => {
  let ausfall = false;
  const fehlerzeilen = [];
  t.mock.method(console, "error", (...zeile) => fehlerzeilen.push(zeile.join(" ")));
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz((text) => {
    if (ausfall && /nummern_lebend_gesamt/.test(text)) throw new Error("Zaehlerausfall");
  });
  ausfall = true;
  assert.deepEqual(await ausloesen(a, MANDANT), { ok: false, reason: "persist_error" });
  assert.equal(await gebucht(umgebung), 0);
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
  assert.deepEqual(a.store.load().numbers, []);
  assert.ok(fehlerzeilen.includes("[pg] nummernkauf fehlgeschlagen: Zaehlerausfall"));
});

test("Die Zaehlung liefert einer Rolle ohne BYPASSRLS nur die Anzahl", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  await umgebung.sql(MIT_KENNUNG, ["num_geheim", ANDERER, "active", "+12025550999"], ANDERER);
  const zeilen = await umgebung.sql(LEBEND_GESAMT, [""]);
  assert.deepEqual(zeilen, [{ anzahl: 1 }]);
  assert.equal(JSON.stringify(zeilen).includes("num_geheim"), false);
  const sichtbar = await umgebung.sql("SELECT count(*)::int AS anzahl FROM number");
  assert.deepEqual(sichtbar, [{ anzahl: 0 }]);
});
