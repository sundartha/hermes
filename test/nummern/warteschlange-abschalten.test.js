import http from "node:http";
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";
import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";
import { fakeProvisioner, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeGracefulShutdown } from "../../src/abschalten.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.ts";
import { handleProvisionJob } from "../../src/worker/provisioning.ts";

const KIND = "provision_number";
const NUMBER = { REQUESTED: "requested", ACTIVE: "active" };
const JOB = { QUEUED: "queued", DONE: "done" };

const TAKT_MS = 30_000;
const GESAMTFRIST_MS = 8000;
const FLUSH_DAUER_MS = 1000;
const UHR_SCHRITT_MS = 100;
const ZEITGRENZE_MS = 60_000;
const EXIT_OK = 0;
const TENANT = "t_abschalten";
const ANBIETER_NUMMER = { e164: "+4915799990001", providerNumberId: "num_ext_abschalten" };

const KAUF_ENDE = "kauf-ende";
const GESTOPPT = "[shutdown] Warteschlange gestoppt";
const NICHT_RECHTZEITIG = "[shutdown] Warteschlange nicht rechtzeitig gestoppt - weiter mit Flush";
const STOPP_FEHLGESCHLAGEN = "[shutdown] Warteschlange-Stopp fehlgeschlagen: Verbindung weg";
const FLUSH_FERTIG = "[shutdown] Finaler Store-Flush abgeschlossen";
const GESAMTFRIST_ABGELAUFEN = "[shutdown] Gesamtfrist abgelaufen - Exit 1";

const naechsterZug = () => new Promise((fertig) => setImmediate(fertig));

function neuesTor() {
  let oeffnen;
  const offen = new Promise((fertig) => {
    oeffnen = fertig;
  });
  return { offen, oeffnen };
}

function zustandMitNummern(...numberIds) {
  return {
    numberAssignments: [],
    numbers: numberIds.map((id) => ({
      id,
      tenantId: TENANT,
      status: NUMBER.REQUESTED,
      e164: null,
      country: "DE",
    })),
    provisioningJobs: numberIds.map((id) => ({
      id: `job_${id}`,
      numberId: id,
      tenantId: TENANT,
      kind: KIND,
      status: JOB.QUEUED,
      idempotencyKey: `provision_${id}`,
      attempts: 0,
      lastError: null,
    })),
  };
}

const findNumber = (state, id) => state.numbers.find((number) => number.id === id) ?? null;

function markProvisioningJob(state, jobId, status) {
  const job = state.provisioningJobs.find((kandidat) => kandidat.id === jobId);
  job.status = status;
  return job;
}

const auftrag = (numberId) => ({
  kind: KIND,
  payload: { numberId },
  idempotencyKey: `provision_${numberId}`,
});

function beobachteteWarteschlange(queue, eigenschaften = {}) {
  const aufrufe = { start: 0, enqueue: 0, drain: 0 };
  const beobachtet = {
    ...queue,
    start() {
      aufrufe.start += 1;
      return queue.start();
    },
    enqueue(job) {
      aufrufe.enqueue += 1;
      return queue.enqueue(job);
    },
    drain(handler) {
      aufrufe.drain += 1;
      return queue.drain(handler);
    },
    ...eigenschaften,
  };
  return { aufrufe, queue: beobachtet };
}

function baueOrchestrator({
  queue,
  state,
  store = { load: () => state, save() {} },
  handle = handleProvisionJob,
  anbieter = fakeProvisioner(),
}) {
  return makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({
      ...OHNE_EL_ZUGANG,
      paymentEnabled: false,
      provisioningEnabled: true,
      provisioningRedriveMaxAgeMs: 3_600_000,
    }),
    queue,
    billing: {},
    metering: {},
    numberProvisioning: () => anbieter,
    handleProvisionJob: handle,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: (_state, { numberId }) => ({ id: `job_${numberId}` }),
    markProvisioningJob,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });
}

function schutzfristen(t) {
  mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => mock.timers.reset());
}

function abschaltung({
  orchestrator,
  httpServer,
  tor = null,
  beimFlush = naechsterZug,
  ereignisse = [],
  standBeimFlush = () => null,
}) {
  const ausstiege = [];
  const flushStaende = [];
  const logZeilen = [];
  const fehlerzeilen = [];
  const store = {
    save: async () => {
      await beimFlush();
    },
    drainFlushes: async () => {
      flushStaende.push(standBeimFlush());
    },
  };
  const gracefulShutdown = makeGracefulShutdown({
    httpServer,
    store,
    config: { server: { shutdownDrainTimeoutMs: GESAMTFRIST_MS } },
    stopQueue: () => {
      if (tor) setImmediate(tor.oeffnen);
      return orchestrator.stopQueue();
    },
    exit: (code) => ausstiege.push(code),
    log: (zeile) => {
      logZeilen.push(zeile);
      ereignisse.push(zeile);
    },
    logError: (zeile) => {
      fehlerzeilen.push(zeile);
      ereignisse.push(zeile);
    },
  });
  return { gracefulShutdown, ereignisse, logZeilen, fehlerzeilen, ausstiege, flushStaende };
}

const keineAnfragen = () => ({ close: (fertig) => fertig(), closeIdleConnections() {} });

function kauf(ereignisse, tor) {
  const stand = { begonnen: null };
  const hatBegonnen = new Promise((fertig) => {
    stand.begonnen = fertig;
  });
  const anbieter = fakeProvisioner({
    async orderNumber() {
      stand.begonnen();
      await tor.offen;
      ereignisse.push(KAUF_ENDE);
      return ANBIETER_NUMMER;
    },
  });
  return { anbieter, hatBegonnen, stand };
}

test(
  "K1b-A1: pgboss und SIGTERM - Warteschlange gestoppt steht vor dem finalen Store-Flush, Exit 0",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const srv = await startServer({ env: { QUEUE_BACKEND: "pgboss", DATABASE_URL: db.adresse } });
    t.after(() => srv.stop());
    await srv.stop();
    const gestoppt = srv.stdout.indexOf(GESTOPPT);
    const geflusht = srv.stdout.indexOf(FLUSH_FERTIG);
    assert.ok(gestoppt >= 0, `"${GESTOPPT}" fehlt:\n${srv.stdout}`);
    assert.ok(geflusht > gestoppt, `Flush muss nach dem Stopp stehen:\n${srv.stdout}`);
    assert.equal(srv.child.exitCode, EXIT_OK);
  },
);

test("K1b-A2: ein laufender Kauf wird beim SIGTERM abgewartet, bevor die Warteschlange als gestoppt gilt", async (t) => {
  const umgebung = await pgBossUmgebung(t, { clock: neueUhr() });
  const state = zustandMitNummern("num_a2");
  const ereignisse = [];
  const tor = neuesTor();
  const { anbieter, hatBegonnen } = kauf(ereignisse, tor);
  const orchestrator = baueOrchestrator({ queue: umgebung.queue, state, anbieter });
  const id = await umgebung.queue.enqueue(auftrag("num_a2"));
  void orchestrator.runProvisioningDrainExclusive();
  await hatBegonnen;
  const lauf = abschaltung({
    orchestrator,
    httpServer: keineAnfragen(),
    tor,
    ereignisse,
    standBeimFlush: () => [findNumber(state, "num_a2").status, state.provisioningJobs[0].status],
  });
  await lauf.gracefulShutdown("SIGTERM");
  assert.deepEqual(lauf.flushStaende, [[NUMBER.ACTIVE, JOB.DONE]]);
  assert.equal(await umgebung.queue.jobStatus(id), JOB.DONE);
  const kaufEnde = ereignisse.indexOf(KAUF_ENDE);
  const gestoppt = ereignisse.indexOf(GESTOPPT);
  assert.ok(kaufEnde >= 0 && gestoppt > kaufEnde, ereignisse.join("\n"));
  assert.deepEqual(lauf.ausstiege, [EXIT_OK]);
});

test("K1b-A3: nach dem Stopp starten weder Takt, Abruf noch Einreihen die Warteschlange neu", async (t) => {
  const umgebung = await pgBossUmgebung(t, { clock: neueUhr() });
  schutzfristen(t);
  const { store } = await makePgTestStore();
  const ereignisse = [];
  let begonnen;
  const hatBegonnen = new Promise((fertig) => {
    begonnen = fertig;
  });
  const tor = neuesTor();
  const aufgerufen = [];
  const handle = async (_state, job) => {
    aufgerufen.push(job.payload.numberId);
    begonnen();
    await tor.offen;
    return {};
  };
  const beobachtet = beobachteteWarteschlange(umgebung.queue);
  const orchestrator = baueOrchestrator({ queue: beobachtet.queue, store, handle });
  await orchestrator.startQueue();
  await beobachtet.queue.enqueue(auftrag("num_a3_laufend"));
  const abruf = orchestrator.runProvisioningDrainExclusive();
  await hatBegonnen;
  const lauf = abschaltung({ orchestrator, httpServer: keineAnfragen(), tor, ereignisse });
  await lauf.gracefulShutdown("SIGTERM");
  await abruf;
  beobachtet.aufrufe.start = 0;
  beobachtet.aufrufe.enqueue = 0;
  beobachtet.aufrufe.drain = 0;
  mock.timers.tick(3 * TAKT_MS);
  await naechsterZug();
  const einreihen = await orchestrator.queueProvisioning("num_a3_spaeter", TENANT);
  await orchestrator.runProvisioningDrainExclusive();
  assert.equal(einreihen.ok, true, "Job-Spur wird weiter geschrieben");
  assert.equal(beobachtet.aufrufe.start, 0, "Adapter-start nach dem Stopp");
  assert.equal(beobachtet.aufrufe.enqueue, 0, "Adapter-enqueue nach dem Stopp");
  assert.equal(beobachtet.aufrufe.drain, 0, "Adapter-drain nach dem Stopp");
  assert.deepEqual(aufgerufen, ["num_a3_laufend"], "kein Handler fuer weitere Auftraege");
});

test(
  "K1b-A4: ein hängender Stopp verdrängt den Flush nicht, die Gesamtfrist läuft nicht ab",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await pgBossUmgebung(t, { clock: neueUhr() });
    const haengend = beobachteteWarteschlange(umgebung.queue, { stop: () => new Promise(() => {}) });
    const orchestrator = baueOrchestrator({ queue: haengend.queue, state: zustandMitNummern() });
    const httpServer = http.createServer(() => {});
    await new Promise((fertig) => httpServer.listen(0, "127.0.0.1", fertig));
    t.after(() => httpServer.closeAllConnections());
    t.after(() => httpServer.close());
    const angefragt = new Promise((fertig) => httpServer.once("request", fertig));
    abrufMitFrist(
      `http://127.0.0.1:${httpServer.address().port}/`,
      {},
      { wartezeitMs: GESAMTFRIST_MS },
    ).catch(() => {});
    await angefragt;
    const lauf = abschaltung({
      orchestrator,
      httpServer,
      beimFlush: async () => {
        t.mock.timers.tick(FLUSH_DAUER_MS);
        await naechsterZug();
      },
    });
    await orchestrator.startQueue();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const abgeschaltet = lauf.gracefulShutdown("SIGTERM");
    let beendet = false;
    void abgeschaltet.then(() => {
      beendet = true;
    });
    while (!beendet) {
      await naechsterZug();
      t.mock.timers.tick(UHR_SCHRITT_MS);
    }
    const nichtRechtzeitig = lauf.ereignisse.indexOf(NICHT_RECHTZEITIG);
    const geflusht = lauf.ereignisse.indexOf(FLUSH_FERTIG);
    assert.ok(nichtRechtzeitig >= 0, lauf.ereignisse.join("\n"));
    assert.ok(lauf.logZeilen.includes(NICHT_RECHTZEITIG), lauf.ereignisse.join("\n"));
    assert.ok(!lauf.fehlerzeilen.includes(NICHT_RECHTZEITIG), lauf.ereignisse.join("\n"));
    assert.ok(geflusht > nichtRechtzeitig, lauf.ereignisse.join("\n"));
    assert.ok(!lauf.ereignisse.includes(GESAMTFRIST_ABGELAUFEN), lauf.ereignisse.join("\n"));
    assert.deepEqual(lauf.ausstiege, [EXIT_OK]);
  },
);

test("K1b-A5: ein scheiternder Stopp verdrängt den Flush nicht", async (t) => {
  const umgebung = await pgBossUmgebung(t, { clock: neueUhr() });
  const scheiternd = beobachteteWarteschlange(umgebung.queue, {
    stop: () => Promise.reject(new Error("Verbindung weg")),
  });
  const orchestrator = baueOrchestrator({ queue: scheiternd.queue, state: zustandMitNummern() });
  const lauf = abschaltung({ orchestrator, httpServer: keineAnfragen() });
  await orchestrator.startQueue();
  await lauf.gracefulShutdown("SIGTERM");
  assert.ok(lauf.fehlerzeilen.includes(STOPP_FEHLGESCHLAGEN), lauf.ereignisse.join("\n"));
  assert.ok(!lauf.logZeilen.includes(STOPP_FEHLGESCHLAGEN), lauf.ereignisse.join("\n"));
  assert.ok(lauf.ereignisse.includes(FLUSH_FERTIG), lauf.ereignisse.join("\n"));
  assert.deepEqual(lauf.ausstiege, [EXIT_OK]);
});

test(
  "K1b-A6: mit memory steht keine Warteschlangen-Zeile im Abschalt-Log, Exit 0",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const srv = await startServer({ env: { QUEUE_BACKEND: "memory" } });
    t.after(() => srv.stop());
    await srv.stop();
    assert.ok(srv.stdout.includes(FLUSH_FERTIG), `Abschalten nicht gelaufen:\n${srv.stdout}`);
    assert.doesNotMatch(srv.stdout, /Warteschlange/);
    assert.equal(srv.child.exitCode, EXIT_OK);
  },
);
