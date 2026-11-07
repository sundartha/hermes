import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung, wackeligeWarteschlange } from "../gemeinsam/pgboss-umgebung.js";
import { fakeProvisioner } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { config } from "../../src/config.js";
import { createQueue } from "../../src/queue/registry.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const KIND = "provision_number";
const NUMBER = { REQUESTED: "requested", ACTIVE: "active", FAILED: "failed" };
const JOB = { QUEUED: "queued", DONE: "done", FAILED: "failed" };

const TAKT_MS = 30_000;
const MINUTE_MS = 60_000;
const ABLAUF_MS = 30 * MINUTE_MS;
const TENANT = "t_takt";
const ANBIETER_FEHLER = "Anbieter nicht erreichbar";
const TAKT_PRAEFIX = "[provision-takt]";

function zustandMitNummer() {
  const numberId = "num_takt";
  const state = {
    numbers: [{ id: numberId, tenantId: TENANT, status: NUMBER.REQUESTED, e164: null, country: "DE" }],
    provisioningJobs: [
      {
        id: "job_takt",
        numberId,
        tenantId: TENANT,
        kind: KIND,
        status: JOB.QUEUED,
        idempotencyKey: `provision_${numberId}`,
        attempts: 0,
        lastError: null,
      },
    ],
  };
  return { state, numberId };
}

const findNumber = (state, id) => state.numbers.find((number) => number.id === id) ?? null;

function markProvisioningJob(state, jobId, ...ausgang) {
  const [status, lastError = null] = ausgang;
  const job = state.provisioningJobs.find((kandidat) => kandidat.id === jobId);
  job.status = status;
  job.attempts += 1;
  if (lastError) job.lastError = lastError;
  return job;
}

function auftrag(numberId) {
  return {
    kind: KIND,
    payload: { numberId },
    idempotencyKey: `provision_${numberId}`,
  };
}

function zaehlenderHandler(verhalten = () => ({})) {
  const handler = {
    aufrufe: 0,
    handle: async (state, job, deps) => {
      handler.aufrufe += 1;
      return verhalten({ versuch: handler.aufrufe, state, job, deps });
    },
  };
  return handler;
}

function beobachteteWarteschlange(queue) {
  const beobachter = { begonnen: 0, laeufe: [] };
  beobachter.queue = {
    ...queue,
    drain(handler) {
      beobachter.begonnen += 1;
      const lauf = queue.drain(handler);
      beobachter.laeufe.push(lauf);
      return lauf;
    },
  };
  return beobachter;
}

function baueOrchestrator({ queue, state, handle, anbieter, provisioningEnabled = true }) {
  const beobachter = beobachteteWarteschlange(queue);
  const orchestrator = makeProvisioningOrchestrator({
    store: { load: () => state, save() {} },
    config: withConfigNamespaces({
      paymentEnabled: false,
      provisioningEnabled,
      provisioningRedriveMaxAgeMs: 3_600_000,
    }),
    queue: beobachter.queue,
    billing: {},
    metering: {},
    numberProvisioning: () => anbieter,
    handleProvisionJob: handle,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: () => null,
    markProvisioningJob,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });
  return { orchestrator, beobachter };
}

function takteSimulieren(t) {
  mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => mock.timers.reset());
}

const naechsterZug = () => new Promise((fertig) => setImmediate(fertig));

async function taktenUndAbwarten(beobachter, zeit = TAKT_MS) {
  mock.timers.tick(zeit);
  await naechsterZug();
  await Promise.allSettled(beobachter.laeufe);
}

async function pgBossBetrieb(t, optionen) {
  const clock = neueUhr();
  const umgebung = await pgBossUmgebung(t, { clock });
  takteSimulieren(t);
  const betrieb = baueOrchestrator({ queue: umgebung.queue, ...optionen });
  await betrieb.orchestrator.startQueue();
  return { ...umgebung, ...betrieb, clock };
}

test("K1b-T1: scheitert der erste Versuch vor dem Kauf, holt der Takt die Wiederholung ab, ohne Aufruf von außen", async (t) => {
  const { state, numberId } = zustandMitNummer();
  const handler = zaehlenderHandler(({ versuch, state: s, job }) => {
    if (versuch === 1) throw new Error(ANBIETER_FEHLER);
    findNumber(s, job.payload.numberId).status = NUMBER.ACTIVE;
    return {};
  });
  const betrieb = await pgBossBetrieb(t, { state, handle: handler.handle, anbieter: {} });
  const id = await betrieb.queue.enqueue(auftrag(numberId));
  await taktenUndAbwarten(betrieb.beobachter);
  assert.equal(handler.aufrufe, 1, "erster Versuch beim ersten Takt");
  await betrieb.clock.tick(MINUTE_MS);
  await taktenUndAbwarten(betrieb.beobachter);
  assert.equal(handler.aufrufe, 2);
  assert.equal(await betrieb.queue.jobStatus(id), "done");
});

test("K1b-T1b: ein gescheiterter Kauf bleibt in der Job-Spur failed, die übersprungene Wiederholung überschreibt ihn nicht", async (t) => {
  const { state, numberId } = zustandMitNummer();
  let kaeufe = 0;
  const anbieter = fakeProvisioner({
    async orderNumber() {
      kaeufe += 1;
      throw new Error(ANBIETER_FEHLER);
    },
  });
  const betrieb = await pgBossBetrieb(t, { state, handle: handleProvisionJob, anbieter });
  await betrieb.queue.enqueue(auftrag(numberId));
  await taktenUndAbwarten(betrieb.beobachter);
  assert.equal(findNumber(state, numberId).status, NUMBER.FAILED);
  await betrieb.clock.tick(MINUTE_MS);
  await taktenUndAbwarten(betrieb.beobachter);
  const [spur] = state.provisioningJobs;
  assert.equal(spur.status, JOB.FAILED);
  assert.equal(spur.lastError, ANBIETER_FEHLER);
  assert.equal(kaeufe, 1, "kein zweiter Kauf");
});

test("K1b-T2: ein nach Absturz liegengebliebener Auftrag wird nach Ablauf beim nächsten Takt abgearbeitet", async (t) => {
  const { state, numberId } = zustandMitNummer();
  const handler = zaehlenderHandler();
  const betrieb = await pgBossBetrieb(t, { state, handle: handler.handle, anbieter: {} });
  const id = await betrieb.queue.enqueue(auftrag(numberId));
  await betrieb.db.abfragen(
    "UPDATE pgboss.job SET state = 'active', started_on = to_timestamp($1 / 1000.0) WHERE name = $2",
    [betrieb.clock.now(), KIND],
  );
  await taktenUndAbwarten(betrieb.beobachter);
  assert.equal(handler.aufrufe, 0, "vor Ablauf nicht fällig");
  await betrieb.clock.tick(ABLAUF_MS);
  await taktenUndAbwarten(betrieb.beobachter);
  assert.equal(handler.aufrufe, 1);
  assert.equal(await betrieb.queue.jobStatus(id), "done");
});

test("K1b-T3: mit memory gibt es keinen Takt, der Auftrag wartet weiter", async (t) => {
  const { state, numberId } = zustandMitNummer();
  const handler = zaehlenderHandler();
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  takteSimulieren(t);
  const betrieb = baueOrchestrator({ queue, state, handle: handler.handle, anbieter: {} });
  const id = await queue.enqueue(auftrag(numberId));
  await betrieb.orchestrator.startQueue();
  await taktenUndAbwarten(betrieb.beobachter, MINUTE_MS);
  assert.equal(handler.aufrufe, 0);
  assert.equal(queue.jobStatus(id), "queued");
});

test("K1b-T4: im Dry-Run (PROVISIONING_ENABLED=false) gibt es keinen Takt, der Auftrag wartet weiter", async (t) => {
  const { state, numberId } = zustandMitNummer();
  const handler = zaehlenderHandler();
  const betrieb = await pgBossBetrieb(t, {
    state,
    handle: handler.handle,
    anbieter: {},
    provisioningEnabled: false,
  });
  const id = await betrieb.queue.enqueue(auftrag(numberId));
  await taktenUndAbwarten(betrieb.beobachter, MINUTE_MS);
  assert.equal(handler.aufrufe, 0);
  assert.equal(await betrieb.queue.jobStatus(id), "queued");
});

test("K1b-T5: während ein Abruf läuft, beginnt kein Takt einen zweiten, danach beginnt der nächste wieder einen", async (t) => {
  const { state, numberId } = zustandMitNummer();
  let freigeben;
  const kaufLaeuft = new Promise((fertig) => {
    freigeben = fertig;
  });
  let kaufBegonnen;
  const kaufHatBegonnen = new Promise((fertig) => {
    kaufBegonnen = fertig;
  });
  const anbieter = fakeProvisioner({
    async orderNumber() {
      kaufBegonnen();
      await kaufLaeuft;
      return {};
    },
  });
  const handler = zaehlenderHandler(({ deps }) => deps.provisioner.orderNumber({}));
  const betrieb = await pgBossBetrieb(t, { state, handle: handler.handle, anbieter });
  await betrieb.queue.enqueue(auftrag(numberId));
  mock.timers.tick(3 * TAKT_MS);
  await naechsterZug();
  assert.equal(betrieb.beobachter.begonnen, 1, "drei Takte, ein Abruf");
  await kaufHatBegonnen;
  assert.equal(handler.aufrufe, 1);
  freigeben();
  await Promise.allSettled(betrieb.beobachter.laeufe);
  await naechsterZug();
  await taktenUndAbwarten(betrieb.beobachter);
  assert.equal(betrieb.beobachter.begonnen, 2, "nächster Takt beginnt wieder einen Abruf");
  assert.equal(handler.aufrufe, 1, "der erledigte Auftrag wird nicht noch einmal gekauft");
});

test("K1b-T6: ein Datenbankfehler im Takt wird mit [provision-takt] geloggt, der nächste Takt arbeitet den Auftrag ab", async (t) => {
  const { state, numberId } = zustandMitNummer();
  const handler = zaehlenderHandler();
  const { queue, zustand } = await wackeligeWarteschlange(t);
  zustand.ausfall = false;
  takteSimulieren(t);
  const betrieb = baueOrchestrator({ queue, state, handle: handler.handle, anbieter: {} });
  await betrieb.orchestrator.startQueue();
  const id = await queue.enqueue(auftrag(numberId));
  const unbehandelt = [];
  const merken = (grund) => unbehandelt.push(grund);
  process.on("unhandledRejection", merken);
  t.after(() => process.off("unhandledRejection", merken));
  const fehlerLog = t.mock.method(console, "error", () => {});
  zustand.ausfall = true;
  await taktenUndAbwarten(betrieb.beobachter);
  const zeilen = fehlerLog.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
  assert.ok(
    zeilen.some((zeile) => zeile.startsWith(TAKT_PRAEFIX)),
    `Fehlerlog ohne ${TAKT_PRAEFIX}: ${JSON.stringify(zeilen)}`,
  );
  assert.equal(handler.aufrufe, 0);
  zustand.ausfall = false;
  await taktenUndAbwarten(betrieb.beobachter);
  assert.equal(handler.aufrufe, 1);
  assert.equal(await queue.jobStatus(id), "done");
  assert.deepEqual(unbehandelt, []);
});
