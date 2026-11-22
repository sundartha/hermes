import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { config as basisKonfiguration } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.ts";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.ts";
import { handleProvisionJob } from "../../src/worker/provisioning.ts";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeConfigOverrides } from "../helpers.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const { withConfigOverrides } = makeConfigOverrides(basisKonfiguration);
const MANDANT = "t_kauf_besitz";
const NUMMER_ID = "num_kauf_besitz";
const KENNUNG_A = "a-host:00000000-0000-4000-8000-0000000000a1";
const KENNUNG_B = "b-host:00000000-0000-4000-8000-0000000000b2";
const KENNUNG_C = "c-host:00000000-0000-4000-8000-0000000000c3";
const EINMAL = 1;
const ZWEI = 2;
const ZWEITER_AUFTRAG = "job_zweiter";
const konfig = withConfigNamespaces({
  ...OHNE_EL_ZUGANG,
  paymentEnabled: false,
  provisioningEnabled: true,
  maxNumbers: 50,
  maxNumbersPerTenant: 5,
  provisioningRedriveMaxAgeMs: 3_600_000,
  geoEnabled: false,
  provisioningCountry: "US",
  forceNumberCountry: "",
});

function einzelverbindung(db) {
  let kette = Promise.resolve();
  return {
    withClient(arbeit) {
      const lauf = kette.then(() => arbeit({ query: (text, werte) => db.query(text, werte), exec: (sql) => db.exec(sql) }));
      kette = lauf.catch(() => {});
      return lauf;
    },
  };
}

const kontext = (db) => db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);

async function lesen(db, text, werte = []) {
  await kontext(db);
  return (await db.query(text, werte)).rows;
}


async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = einzelverbindung(db);
  await makePgStoreMitSperre(runner).init();
  await kontext(db);
  await db.query("INSERT INTO tenant (id, status, idp_subject, country, kyc_level) VALUES ($1, 'active', $1, 'US', 'card')", [MANDANT]);
  await db.query("INSERT INTO number (id, tenant_id, provider, status, country, language) VALUES ($1, $2, 'telnyx', 'requested', 'US', 'en')", [NUMMER_ID, MANDANT]);
  return { db, runner, bestellungen: [], zustand: { lesbar: true } };
}

async function instanz(umgebung, kennung, kauf = konfig) {
  const { db, runner, bestellungen, zustand } = umgebung;
  const store = makePgStoreMitSperre(runner, { kennung });
  await store.init();
  store.besitzLage = async () => {
    if (!zustand.lesbar) return { eigene: kennung, lebende: null };
    const { rows } = await db.query("SELECT kennung FROM instanz_lebenszeichen");
    return { eigene: kennung, lebende: rows.map((zeile) => zeile.kennung) };
  };
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  const einreihungen = mock.method(queue, "enqueue");
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: kauf,
    queue,
    billing: {},
    metering: {},
    numberProvisioning: () => ({
      searchNumbers: async () => [{ e164: `+1202555020${bestellungen.length}` }],
      orderNumber: async ({ e164 }) => {
        bestellungen.push(kennung);
        return { e164, providerNumberId: "pn_besitz" };
      },
    }),
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs,
    findNumber,
  });
  return { store, orchestrator, einreihungen };
}

const findNumber = (zustand, id) => zustand.numbers.find((nummer) => nummer.id === id);
const recordProvisioningJob = () => null;
const classifyQueuedProvisioningJobs = (zustand) => ({
  close: [],
  hold: [],
  redrive: zustand.provisioningJobs.filter((job) => job.status === "queued" && findNumber(zustand, job.numberId)?.status === "requested"),
});

function markProvisioningJob(zustand, id, status) {
  Object.assign(zustand.provisioningJobs.find((job) => job.id === id), { status });
}

const lebt = (db, kennung) => db.query("INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um) VALUES ($1, now()) ON CONFLICT (kennung) DO UPDATE SET gemeldet_um = now()", [kennung]);
const stirbt = (db, kennung) => db.query("DELETE FROM instanz_lebenszeichen WHERE kennung = $1", [kennung]);

async function abgleichenUndAbarbeiten(...instanzen) {
  await Promise.all(instanzen.map((eine) => eine.orchestrator.reconcileOrphanedProvisioning()));
  for (const eine of instanzen) await eine.orchestrator.runProvisioningDrainExclusive();
  for (const eine of instanzen) await eine.store.drainFlushes();
}


async function auftragVonA(umgebung) {
  const a = await instanz(umgebung, KENNUNG_A);
  await lebt(umgebung.db, KENNUNG_A);
  assert.equal((await a.orchestrator.queueProvisioning(NUMMER_ID, MANDANT)).ok, true);
  await a.store.drainFlushes();
  return a;
}


async function zweiterAuftragVonA(db) {
  await kontext(db);
  await db.query("INSERT INTO number (id, tenant_id, provider, status, country, language) VALUES ('num_zweiter', $1::text, 'telnyx', 'requested', 'US', 'en')", [MANDANT]);
  await db.query("INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, created_at, instanz) SELECT $1::text, tenant_id, 'num_zweiter', kind, status, 'schluessel_zweiter', 0, created_at, instanz FROM provisioning_job LIMIT 1", [ZWEITER_AUFTRAG]);
}

test("Nummernkauf: liest B nach der Uebernahme nicht mehr alle Mandanten, bestellt B den Auftrag im selben Takt genau einmal", async (t) => {
  const umgebung = await aufbau();
  for (const art of ["log", "warn", "error"]) t.mock.method(console, art, () => {});
  const b = await instanz(umgebung, KENNUNG_B);
  await auftragVonA(umgebung);
  await lebt(umgebung.db, KENNUNG_B);
  await stirbt(umgebung.db, KENNUNG_A);
  const sql = b.store.nummernSql();
  const offene = sql.offene;
  let aufrufe = 0;
  sql.offene = (...args) => {
    aufrufe += 1;
    if (aufrufe > EINMAL) throw new Error("zweites Lesen aller Mandanten");
    return offene(...args);
  };
  await abgleichenUndAbarbeiten(b);
  assert.equal(aufrufe, EINMAL);
  assert.deepEqual(umgebung.bestellungen, [KENNUNG_B]);
  assert.equal(b.einreihungen.mock.callCount(), EINMAL);
  assert.deepEqual(await lesen(umgebung.db, "SELECT status, instanz FROM provisioning_job"), [{ status: "done", instanz: KENNUNG_B }]);
});

test("Nummernkauf: wirft die Uebernahme eines Auftrags, wird der gewonnene bestellt und der andere im naechsten Takt", async (t) => {
  const umgebung = await aufbau();
  const fehler = t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  const b = await instanz(umgebung, KENNUNG_B);
  await auftragVonA(umgebung);
  await zweiterAuftragVonA(umgebung.db);
  await lebt(umgebung.db, KENNUNG_B);
  await stirbt(umgebung.db, KENNUNG_A);
  const sql = b.store.nummernSql();
  const uebernehmen = sql.auftragUebernommen;
  sql.auftragUebernommen = (eingabe) => {
    if (eingabe.jobId === ZWEITER_AUFTRAG) throw new Error("update kaputt");
    return uebernehmen(eingabe);
  };
  await abgleichenUndAbarbeiten(b);
  assert.equal(umgebung.bestellungen.length, EINMAL);
  assert.deepEqual(await lesen(umgebung.db, "SELECT id, instanz FROM provisioning_job WHERE status = 'queued'"), [{ id: ZWEITER_AUFTRAG, instanz: KENNUNG_A }]);
  assert.deepEqual(fehler.mock.calls.map((aufruf) => aufruf.arguments), [[`[provision-reconcile] Uebernahme fehlgeschlagen job=${ZWEITER_AUFTRAG}`]]);
  sql.auftragUebernommen = uebernehmen;
  await abgleichenUndAbarbeiten(b);
  assert.equal(umgebung.bestellungen.length, ZWEI);
  assert.deepEqual(await lesen(umgebung.db, "SELECT status FROM provisioning_job"), [{ status: "done" }, { status: "done" }]);
});
