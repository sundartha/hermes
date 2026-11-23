import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { config as basisKonfiguration } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.ts";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.ts";
import { speicherBereiche } from "../../src/store.js";
import { handleProvisionJob } from "../../src/worker/provisioning.ts";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { makeConfigOverrides } from "../helpers.js";
import { makePgStoreMitSperre } from "../pg-helpers.js";

const { withConfigOverrides } = makeConfigOverrides(basisKonfiguration);
const ZEITGRENZE_MS = 120_000;
const MANDANTEN = ["t_plattform_a", "t_plattform_b", "t_plattform_c"];
const [A, B, C] = MANDANTEN;
const E164 = "+12025550188";
const POOL_GROESSE = 4;
const KONTEXT = "SELECT set_config('app.current_tenant', $1, false)";
const FREMDE_NUMMER = "INSERT INTO number (id, tenant_id, status) VALUES ($1, $2, $3)";
const STATUS_SETZEN = "UPDATE number SET status = $2 WHERE id = $1";
const NUMMERN_ZAEHLEN = "SELECT count(*)::int AS anzahl FROM number";
const ZAEHLER_LESEN = "SELECT nummern_lebend_gesamt()::int AS anzahl";
const ZAEHLER_ZEILEN = "SELECT id::int AS id, anzahl::int AS anzahl FROM nummer_lebend_zahl";
const NUMMERN_LESEN = "SELECT id FROM number";

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

function stubs() {
  const job = (numberId, tenantId, idempotencyKey) => ({
    id: `job_${randomUUID()}`, numberId, tenantId, kind: "provision_number", status: "queued", idempotencyKey,
    attempts: 0, lastError: null, createdAt: "2026-11-22T10:00:00.000Z",
  });
  return {
    findNumber: (zustand, id) => zustand.numbers.find((nummer) => nummer.id === id),
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    recordProvisioningJob: (zustand, { numberId, tenantId, idempotencyKey }) => {
      const neu = job(numberId, tenantId, idempotencyKey);
      zustand.provisioningJobs.push(neu);
      return neu;
    },
    markProvisioningJob: (zustand, id, status) => Object.assign(zustand.provisioningJobs.find((eintrag) => eintrag.id === id), { status }),
    resolveProvisionRetry: (zustand, { tenantId }) => {
      const number = {
        id: `num_${randomUUID()}`, e164: null, tenantId, provider: "telnyx", country: "US", language: "en",
        status: "requested", providerNumberId: null, paymentIntentId: null,
      };
      zustand.numbers.push(number);
      return { ok: true, number };
    },
  };
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
  const speicher = [];
  const sql = async (mandant, text, werte = []) => {
    await Promise.all(speicher.map((store) => store.drainFlushes()));
    const abfrage = await start.connect();
    try {
      await abfrage.query(KONTEXT, [mandant]);
      return (await abfrage.query(text, werte)).rows;
    } finally {
      abfrage.release();
    }
  };
  for (const mandant of MANDANTEN) {
    await sql(mandant, "INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, 'active', $1, 'US')", [mandant]);
  }
  const attrappe = anbieter();
  const instanz = async (konfiguration, query) => {
    const store = makePgStoreMitSperre(runnerFuer(neuerPool(), query));
    await store.init();
    speicher.push(store);
    const orchestrator = makeProvisioningOrchestrator({
      store, config: konfiguration, billing: {}, metering: {}, audit: () => {}, handleProvisionJob,
      queue: withConfigOverrides({ queueBackend: "memory" }, () => createQueue()),
      numberProvisioning: attrappe.numberProvisioning,
      ...stubs(),
    });
    return { store, orchestrator };
  };
  const gesamt = async () => {
    const je = await Promise.all(MANDANTEN.map((mandant) => sql(mandant, NUMMERN_ZAEHLEN)));
    return je.reduce((summe, zeilen) => summe + zeilen[0].anzahl, 0);
  };
  return { instanz, attrappe, sql, gesamt, db };
}

async function ausloesenUndAbarbeiten(instanz, mandant) {
  const ergebnis = await instanz.orchestrator.triggerTenantProvisioning(mandant);
  await instanz.orchestrator.runProvisioningDrainExclusive();
  return ergebnis;
}

const ABGELEHNT = { ok: false, reason: "already_provisioned" };
const WARTENDE_SPERREN = "SELECT count(*)::int AS anzahl FROM pg_locks WHERE NOT granted";
const SCHRANKE_VERSUCHE = 20_000;

function schrankeVorDemEinfuegen(beobachter) {
  const gezaehlt = [false, false];
  const instanzMit = (nummer) => async (text) => {
    if (text.includes("nummern_lebend_gesamt")) {
      gezaehlt[nummer] = true;
      return;
    }
    if (!text.startsWith("INSERT INTO number")) return;
    for (let versuch = 0; versuch < SCHRANKE_VERSUCHE; versuch += 1) {
      if (gezaehlt[1 - nummer]) return;
      const { rows } = await beobachter.query(WARTENDE_SPERREN);
      if (rows[0].anzahl > 0) return;
    }
    throw new Error("Schranke vor dem Einfuegen lief ab");
  };
  return [instanzMit(0), instanzMit(1)];
}

test("Zwei Mandanten auf zwei Instanzen kaufen bei Plattformgrenze 1 genau eine Nummer", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const beobachter = new pg.Client({ connectionString: umgebung.db.adresse });
  beobachter.on("error", () => {});
  await beobachter.connect();
  t.after(() => beobachter.end());
  const [vorA, vorB] = schrankeVorDemEinfuegen(beobachter);
  const [a, b] = [await umgebung.instanz(konfig(), vorA), await umgebung.instanz(konfig(), vorB)];
  const ergebnisse = await Promise.all([ausloesenUndAbarbeiten(a, A), ausloesenUndAbarbeiten(b, B)]);
  assert.deepEqual(ergebnisse.map((e) => e.ok).sort(), [false, true]);
  assert.deepEqual(ergebnisse.find((e) => !e.ok), ABGELEHNT);
  assert.equal(await umgebung.gesamt(), 1);
  assert.deepEqual(umgebung.attrappe.bestellungen, [E164]);
  const imSpeicher = ({ store }) => store.load().numbers.length;
  assert.equal(imSpeicher(a) + imSpeicher(b), 1);
});

test("Plattformgrenze 2 laesst den Kauf neben einer fremden lebenden Nummer zu", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(konfig({ maxNumbers: 2 }));
  await umgebung.sql(B, FREMDE_NUMMER, ["num_fremd_1", B, "active"]);
  assert.equal((await ausloesenUndAbarbeiten(a, A)).ok, true);
  assert.deepEqual(umgebung.attrappe.bestellungen, [E164]);
  assert.equal(await umgebung.gesamt(), 2);
});

test("Plattformgrenze 2 lehnt den Kauf neben zwei fremden lebenden Nummern ab", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(konfig({ maxNumbers: 2 }));
  await umgebung.sql(B, FREMDE_NUMMER, ["num_fremd_1", B, "active"]);
  await umgebung.sql(C, FREMDE_NUMMER, ["num_fremd_2", C, "suspended"]);
  assert.deepEqual(await ausloesenUndAbarbeiten(a, A), ABGELEHNT);
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
  assert.equal(await umgebung.gesamt(), 2);
  assert.deepEqual(a.store.load().numbers, []);
});

test("Freigegebene und fehlgeschlagene Nummern anderer Mandanten zaehlen nicht gegen die Plattformgrenze", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(konfig());
  await umgebung.sql(B, FREMDE_NUMMER, ["num_fremd_frei", B, "released"]);
  await umgebung.sql(C, FREMDE_NUMMER, ["num_fremd_fehl", C, "failed"]);
  assert.equal((await ausloesenUndAbarbeiten(a, A)).ok, true);
  assert.deepEqual(umgebung.attrappe.bestellungen, [E164]);
  assert.equal(await umgebung.gesamt(), 3);
});

test("Eine fremde Nummer im Status requested zaehlt gegen die Plattformgrenze", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(konfig());
  await umgebung.sql(B, FREMDE_NUMMER, ["num_fremd_req", B, "requested"]);
  assert.deepEqual(await ausloesenUndAbarbeiten(a, A), ABGELEHNT);
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
  assert.equal(await umgebung.gesamt(), 1);
});

test("Eine freigegebene Nummer gibt den Platz unter der Plattformgrenze wieder frei", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(konfig());
  await umgebung.sql(B, FREMDE_NUMMER, ["num_fremd_wechsel", B, "active"]);
  assert.deepEqual(await ausloesenUndAbarbeiten(a, A), ABGELEHNT);
  await umgebung.sql(B, STATUS_SETZEN, ["num_fremd_wechsel", "released"]);
  assert.equal((await ausloesenUndAbarbeiten(a, A)).ok, true);
  await umgebung.sql(B, "DELETE FROM number WHERE id = $1", ["num_fremd_wechsel"]);
  assert.equal((await umgebung.sql(A, ZAEHLER_LESEN))[0].anzahl, 1);
});

test("Faellt die Plattformzaehlung aus, wird nichts gekauft und die Nummer im Speicher zurueckgenommen", { timeout: ZEITGRENZE_MS }, async (t) => {
  let ausfall = false;
  t.mock.method(console, "error", () => {});
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const a = await umgebung.instanz(konfig(), (text) => {
    if (ausfall && /nummern_lebend_gesamt|nummer_lebend_zahl/.test(text)) throw new Error("Zaehlerausfall");
  });
  ausfall = true;
  assert.deepEqual(await ausloesenUndAbarbeiten(a, A), { ok: false, reason: "persist_error" });
  assert.equal(await umgebung.gesamt(), 0);
  assert.deepEqual(umgebung.attrappe.bestellungen, []);
  assert.deepEqual(a.store.load().numbers, []);
});

test("Die Plattformzaehlung gibt einem Mandanten nur eine Anzahl, keine fremden Zeilen", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  await umgebung.sql(B, FREMDE_NUMMER, ["num_fremd_geheim", B, "active"]);
  await umgebung.sql(C, FREMDE_NUMMER, ["num_fremd_geheim_2", C, "requested"]);
  assert.deepEqual(await umgebung.sql(A, NUMMERN_LESEN), []);
  assert.deepEqual(await umgebung.sql(A, ZAEHLER_LESEN), [{ anzahl: 2 }]);
  const zeilen = await umgebung.sql(A, ZAEHLER_ZEILEN);
  assert.deepEqual(zeilen, [{ id: 1, anzahl: 2 }]);
  assert.equal(JSON.stringify(zeilen).includes("num_fremd"), false);
  assert.equal(JSON.stringify(zeilen).includes(B), false);
});

const nummerEingabe = (id, plattformHoechstens) => ({
  tenantId: A,
  number: { id, provider: "telnyx", status: "requested", country: "US", language: "en" },
  hoechstens: 1,
  plattformHoechstens,
});

test("Die eigene schon gespeicherte Nummer zaehlt nicht gegen die Plattformgrenze, eine freigegebene eigene nie als Abzug", { timeout: ZEITGRENZE_MS }, async (t) => {
  const umgebung = await aufbau(t);
  if (!umgebung) return;
  const { store } = await umgebung.instanz(konfig());
  const legeNummerAn = (eingabe) => speicherBereiche(store).nummernkauf.legeNummerAn(eingabe);
  await umgebung.sql(B, FREMDE_NUMMER, ["num_fremd_x", B, "active"]);
  await umgebung.sql(A, FREMDE_NUMMER, ["num_eigen", A, "requested"]);
  assert.deepEqual(await legeNummerAn(nummerEingabe("num_eigen", 2)), { ok: true });
  assert.deepEqual(await legeNummerAn(nummerEingabe("num_neu", 2)), { ok: false });
  await umgebung.sql(A, STATUS_SETZEN, ["num_eigen", "released"]);
  assert.deepEqual(await legeNummerAn(nummerEingabe("num_eigen", 1)), { ok: false });
  assert.deepEqual(await legeNummerAn(nummerEingabe("num_eigen", 2)), { ok: true });
  await umgebung.gesamt();
});
