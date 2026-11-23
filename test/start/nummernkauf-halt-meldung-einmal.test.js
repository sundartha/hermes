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
const MANDANT = "t_halt_meldung";
const NUMMER_ID = "num_halt_meldung";
const KENNUNG_A = "a-host:00000000-0000-4000-8000-0000000000a1";
const KENNUNG_B = "b-host:00000000-0000-4000-8000-0000000000b2";
const FUENF = 5;
const EINMAL = 1;
const ZWEIMAL = 2;
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

async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = einzelverbindung(db);
  await makePgStoreMitSperre(runner).init();
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);
  await db.query("INSERT INTO tenant (id, status, idp_subject, country, kyc_level) VALUES ($1, 'active', $1, 'US', 'card')", [MANDANT]);
  await db.query("INSERT INTO number (id, tenant_id, provider, status, country, language) VALUES ($1, $2, 'telnyx', 'requested', 'US', 'en')", [NUMMER_ID, MANDANT]);
  return { db, runner, haltGrund: { wert: "too_old" } };
}

const findNumber = (zustand, id) => zustand.numbers.find((nummer) => nummer.id === id);

async function instanz(umgebung, kennung) {
  const { db, runner, haltGrund } = umgebung;
  const store = makePgStoreMitSperre(runner, { kennung });
  await store.init();
  store.besitzLage = async () => {
    const { rows } = await db.query("SELECT kennung FROM instanz_lebenszeichen");
    return { eigene: kennung, lebende: rows.map((zeile) => zeile.kennung) };
  };
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  mock.method(queue, "enqueue");
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: konfig,
    queue,
    billing: {},
    metering: {},
    numberProvisioning: () => ({ searchNumbers: async () => [], orderNumber: async () => ({}) }),
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: () => null,
    markProvisioningJob: () => {},
    classifyQueuedProvisioningJobs: (zustand) => ({
      close: [],
      hold: zustand.provisioningJobs
        .filter((job) => job.status === "queued" && findNumber(zustand, job.numberId)?.status === "requested")
        .map((job) => ({ job, reason: haltGrund.wert })),
      redrive: [],
    }),
    findNumber,
  });
  return { store, orchestrator };
}

const lebt = (db, kennung) => db.query("INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um) VALUES ($1, now()) ON CONFLICT (kennung) DO UPDATE SET gemeldet_um = now()", [kennung]);
const stirbt = (db, kennung) => db.query("DELETE FROM instanz_lebenszeichen WHERE kennung = $1", [kennung]);

function meldungen(t) {
  const gesammelt = [];
  for (const art of ["log", "warn", "error"]) t.mock.method(console, art, (...teile) => gesammelt.push(teile.map(String).join(" ")));
  return gesammelt;
}

async function auftragVonA(umgebung) {
  const a = await instanz(umgebung, KENNUNG_A);
  await lebt(umgebung.db, KENNUNG_A);
  await a.orchestrator.queueProvisioning(NUMMER_ID, MANDANT);
  await a.store.drainFlushes();
  await umgebung.db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);
  const { rows } = await umgebung.db.query("SELECT id FROM provisioning_job");
  return rows[0].id;
}

const haltZeilen = (logs, jobId, grund) => logs.filter((zeile) => zeile.startsWith(`[provision-reconcile] hold job=${jobId} `) && zeile.endsWith(` grund=${grund}`));

async function abgleichen(orchestrator, anzahl) {
  for (let i = 0; i < anzahl; i += 1) await orchestrator.reconcileOrphanedProvisioning();
}

test("Halt-Meldung: ein dauerhaft gehaltener Auftrag ohne lebenden Besitzer steht ueber fuenf Abgleiche einmal im Log", async (t) => {
  const umgebung = await aufbau();
  const logs = meldungen(t);
  const jobId = await auftragVonA(umgebung);
  await stirbt(umgebung.db, KENNUNG_A);
  const b = await instanz(umgebung, KENNUNG_B);
  await lebt(umgebung.db, KENNUNG_B);
  await abgleichen(b.orchestrator, FUENF);
  assert.equal(haltZeilen(logs, jobId, "too_old").length, EINMAL, logs.join("|"));
});

test("Halt-Meldung: wechselt der Haltegrund, kommt fuer den neuen Grund eine weitere Zeile", async (t) => {
  const umgebung = await aufbau();
  const logs = meldungen(t);
  const jobId = await auftragVonA(umgebung);
  await stirbt(umgebung.db, KENNUNG_A);
  const b = await instanz(umgebung, KENNUNG_B);
  await lebt(umgebung.db, KENNUNG_B);
  await abgleichen(b.orchestrator, ZWEIMAL);
  umgebung.haltGrund.wert = "no_active_subscriber";
  await abgleichen(b.orchestrator, ZWEIMAL);
  assert.equal(haltZeilen(logs, jobId, "too_old").length, EINMAL, logs.join("|"));
  assert.equal(haltZeilen(logs, jobId, "no_active_subscriber").length, EINMAL, logs.join("|"));
});

test("Halt-Meldung: gehoert der gehaltene Auftrag einer lebenden Fremden, schreibt die Instanz keine hold-Zeile", async (t) => {
  const umgebung = await aufbau();
  const logs = meldungen(t);
  const jobId = await auftragVonA(umgebung);
  const b = await instanz(umgebung, KENNUNG_B);
  await lebt(umgebung.db, KENNUNG_B);
  await abgleichen(b.orchestrator, ZWEIMAL);
  assert.deepEqual(haltZeilen(logs, jobId, "too_old"), [], logs.join("|"));
});
