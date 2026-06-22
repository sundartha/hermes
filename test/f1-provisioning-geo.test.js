// F1 Geo-Provisioning (Phase P7): per-Job-countryCode aus dem Number-Record + Telnyx-
// Geo-Suche. Rein offline (Fakes, kein Netz, kein Server, kein pglite - eigene Datei).
// Prueft: searchParamsForCountry (FR->+33, DE/unbekannt->config-Fallback) UND den
// Drain-Pfad (FR-Request -> +33-Suche; ZWEIMAL drainen -> genau EIN Kauf, R1;
// 0 Treffer -> sauberer Fehler, R5). Die Suchparameter-Tabelle ist die einzige
// Aenderung am Geld-Pfad - die drei Idempotenz-Schloesser bleiben unangetastet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { handleProvisionJob } from "../src/worker/provisioning.js";
import { searchParamsForCountry } from "../src/telephony/provisioning-geo.js";
import { config } from "../src/config.js";
import { fakeProvisioner } from "./helpers.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
  recordProvisioningJob,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS, PROVISION_NUMBER_JOB, PROVISIONING_JOB_STATUS } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };

// Seedet eine 'requested' Number mit explizitem Land (Default DE).
function seedRequested(country = "DE") {
  const s = makeDefaultState();
  registerTenant(s, "t_user1");
  const { number } = requestNumber(s, { tenantId: "t_user1", country, ...CAPS });
  return { s, numberId: number.id };
}

// Spiegelt den Drain aus server.js (runProvisioningDrain): leitet die Suchparameter
// PRO JOB aus number.country ab (searchParamsForCountry) und reicht sie an den Worker
// durch. Ohne store.save (reine Fn). drain wirft NICHT (Adapter faengt handler-Fehler).
function drainWithGeo(queue, s, deps) {
  return queue.drain(async (queuedJob) => {
    const record = s.provisioningJobs.find((j) => j.idempotencyKey === queuedJob.idempotencyKey);
    const number = findNumber(s, queuedJob.payload.numberId);
    const geo = searchParamsForCountry(number?.country);
    try {
      await handleProvisionJob(s, queuedJob, deps, { ...geo });
      if (record) record.status = PROVISIONING_JOB_STATUS.DONE;
    } catch (err) {
      if (record) record.status = PROVISIONING_JOB_STATUS.FAILED;
      throw err;
    }
  });
}

function enqueueProvision(queue, s, numberId) {
  const idempotencyKey = `provision_${numberId}`;
  queue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
  recordProvisioningJob(s, { numberId, tenantId: "t_user1", idempotencyKey });
}

// ---- searchParamsForCountry (Tabelle) ----

test("searchParamsForCountry: FR -> +33-Suche (countryCode FR)", () => {
  const params = searchParamsForCountry("FR");
  assert.equal(params.countryCode, "FR");
});

test("searchParamsForCountry: DE -> globaler config-Fallback (byte-identisch)", () => {
  const params = searchParamsForCountry("DE");
  assert.equal(params.countryCode, config.provisioningCountry);
  assert.equal(params.connectionId, config.telnyxConnectionId);
});

test("searchParamsForCountry: unbekannt/leer -> config-Fallback (kein Crash, R7)", () => {
  for (const c of ["ZZ", "", null, undefined]) {
    const params = searchParamsForCountry(c);
    assert.equal(params.countryCode, config.provisioningCountry, `Fallback fuer ${c}`);
  }
});

test("searchParamsForCountry: case-insensitiv (fr -> FR)", () => {
  assert.equal(searchParamsForCountry("fr").countryCode, "FR");
});

// ---- Drain-Pfad (per-Job-countryCode) ----

test("FR-Request -> Suche mit countryCode FR (per-Job aus number.country)", async () => {
  const { s, numberId } = seedRequested("FR");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov });

  assert.ok(prov.log.includes("search:FR"), `Suche mit FR erwartet, log=${prov.log.join(",")}`);
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.ACTIVE);
});

test("DE-Request -> Suche mit config-Fallback-countryCode (byte-identisch)", async () => {
  const { s, numberId } = seedRequested("DE");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov });

  assert.ok(prov.log.includes(`search:${config.provisioningCountry}`), `log=${prov.log.join(",")}`);
});

test("R1: ZWEIMAL drainen -> genau EIN Kauf (Idempotenz unangetastet)", async () => {
  const { s, numberId } = seedRequested("FR");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov }); // requested -> active
  const processedAgain = await drainWithGeo(queue, s, { provisioner: prov }); // re-drain

  assert.equal(processedAgain, 0, "Job 'done' -> kein erneuter Lauf");
  assert.equal(prov.log.filter((l) => l.startsWith("order")).length, 1, "order GENAU einmal");
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.ACTIVE);
});

test("R5: 0 Treffer -> sauberer Fehler (failed), KEIN Kauf, KEIN Crash", async () => {
  const { s, numberId } = seedRequested("FR");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner({ async searchNumbers() { return []; } });
  enqueueProvision(queue, s, numberId);

  // drain faengt den handler-Fehler (Adapter) -> kein throw nach aussen; Fachzustand pruefen.
  await drainWithGeo(queue, s, { provisioner: prov });

  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED, "0 Treffer -> failed");
  assert.ok(!prov.log.some((l) => l.startsWith("order")), "kein Order ohne Kandidat");
});
