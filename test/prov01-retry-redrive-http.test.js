import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { config } from "../src/config.js";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { makeProvisioningOrchestrator } from "../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../src/worker/provisioning.js";
import { resolveProvisionRetry } from "../src/billing/provision-trigger.js";
import { numberProvisioning } from "../src/telephony/registry.js";
import { makeMetering } from "../src/billing/metering.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  tenantActiveSubscriber,
  recordProvisioningJob,
  markProvisioningJob,
  classifyQueuedProvisioningJobs,
  findNumber,
} from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  TENANT_STATUS,
  KYC_LEVEL,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
  PROVIDER,
} from "../src/store/defaults.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const ORDERED_E164 = "+4915799990001";
const PROVIDER_NUMBER_ID = "num_ext_1";
const ONE_HOUR_MS = 3600000;
const CONNECTION_ID = "conn_1";

async function until(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("until: Bedingung nicht innerhalb des Timeouts erfuellt");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function startHangableTelnyxMock(t) {
  let heldRes = null;
  let searchCount = 0;
  const orderRequests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v2/available_phone_numbers")) {
        searchCount++;
        if (searchCount === 1) {
          heldRes = res;
          return;
        }
        return res.end(JSON.stringify({ data: [{ phone_number: ORDERED_E164 }] }));
      }
      if (req.url === "/v2/number_orders" && req.method === "POST") {
        orderRequests.push(req.headers["idempotency-key"]);
        return res.end(
          JSON.stringify({ data: { phone_numbers: [{ id: "ord_sub_1", phone_number: ORDERED_E164 }] } }),
        );
      }
      if (req.url.startsWith("/v2/phone_numbers?"))
        return res.end(JSON.stringify({ data: [{ id: PROVIDER_NUMBER_ID, phone_number: ORDERED_E164 }] }));
      res.end(JSON.stringify({ data: {} }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const mock = {
    url: `http://127.0.0.1:${server.address().port}`,
    orderRequests,
    searchCount: () => searchCount,
    release() {
      if (!heldRes) return;
      heldRes.end(JSON.stringify({ data: [{ phone_number: ORDERED_E164 }] }));
      heldRes = null;
    },
    close: () => new Promise((r) => server.close(r)),
  };
  t.after(async () => {
    mock.release();
    await mock.close();
  });
  return mock;
}

async function withTelnyxMock(url, fn) {
  const saved = {
    apiKey: config.telephony.telnyxApiKey,
    apiBase: config.telephony.telnyxApiBase,
    connectionId: config.telephony.telnyxConnectionId,
  };
  config.telephony.telnyxApiKey = "KEYtest";
  config.telephony.telnyxApiBase = url;
  config.telephony.telnyxConnectionId = CONNECTION_ID;
  try {
    return await fn();
  } finally {
    config.telephony.telnyxApiKey = saved.apiKey;
    config.telephony.telnyxApiBase = saved.apiBase;
    config.telephony.telnyxConnectionId = saved.connectionId;
  }
}

function buildOrchestrator(state, configOverrides = {}) {
  const store = {
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
    ensureTenant: async () => {},
    tenantActiveSubscriber: (tenantId, minLevel) => tenantActiveSubscriber(state, tenantId, minLevel),
  };
  const cfg = withConfigNamespaces({
    paymentEnabled: false,
    provisioningEnabled: true,
    provisioningRedriveMaxAgeMs: ONE_HOUR_MS,
    provisioningCountry: "DE",
    forceNumberCountry: "",
    maxNumbers: 10,
    maxNumbersPerTenant: 5,
    ...configOverrides,
  });
  return verdrahteOrchestrator(store, cfg, makeMemoryQueue());
}

function verdrahteOrchestrator(store, cfg, queue) {
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: cfg,
    queue,
    billing: {},
    metering: makeMetering({ store }),
    numberProvisioning,
    handleProvisionJob,
    resolveProvisionRetry,
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs,
    findNumber,
  });
  return { store, orchestrator, config: cfg };
}

async function startRetryApp({ store, orchestrator, config: cfg }) {
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({ store, config: cfg, audit: () => {}, provisioning: orchestrator, operatorAuth: operatorAuthPassThrough() }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const retry = (app, tenantId) =>
  abrufMitFrist(`${app.base}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId }),
  });

async function seedAndEnqueue(state, orchestrator, tenantId) {
  registerTenant(state, tenantId, { country: "DE" });
  const r = requestNumber(state, {
    tenantId,
    provider: PROVIDER.TELNYX,
    country: "DE",
    language: "de",
    maxNumbers: 10,
    maxNumbersPerTenant: 5,
  });
  assert.ok(r.ok, `requestNumber fuer ${tenantId} fehlgeschlagen: ${r.reason}`);
  const jobRes = await orchestrator.queueProvisioning(r.number.id, tenantId);
  assert.ok(jobRes.ok, `queueProvisioning fuer ${tenantId} fehlgeschlagen`);
  void orchestrator.runProvisioningDrainExclusive();
  return { numberId: r.number.id, jobId: jobRes.jobId };
}

test("redrive-Erfolg: 200, reason=redrive, jobId gesetzt, danach GENAU EIN Kauf (kein Doppelkauf)", async (t) => {
  const telnyx = await startHangableTelnyxMock(t);
  await withTelnyxMock(telnyx.url, async () => {
    const state = makeDefaultState();
    const { store, orchestrator, config: cfg } = buildOrchestrator(state);

    const hang = await seedAndEnqueue(state, orchestrator, "t_hang");
    await until(() => telnyx.searchCount() >= 1, 4000);

    const stuck = await seedAndEnqueue(state, orchestrator, "t_stuck");
    state.tenants.find((tenant) => tenant.id === "t_stuck").status = TENANT_STATUS.ACTIVE;
    state.tenants.find((tenant) => tenant.id === "t_stuck").kycLevel = KYC_LEVEL.CARD;
    assert.equal(findNumber(state, stuck.numberId).status, NUMBER_STATUS.REQUESTED);
    assert.equal(telnyx.searchCount(), 1, "t_stuck wurde NICHT bearbeitet (Drain haengt noch)");

    const app = await startRetryApp({ store, orchestrator, config: cfg });
    try {
      const retryRes = await retry(app, "t_stuck");
      assert.equal(retryRes.status, 200);
      const retryJson = await retryRes.json();
      assert.equal(retryJson.reason, "redrive");
      assert.equal(retryJson.numberId, stuck.numberId, "dieselbe Nummer, kein Neuanfrage");
      assert.equal(retryJson.jobId, stuck.jobId, "derselbe Job, kein Doppel-Enqueue");

      telnyx.release();
      await until(() => findNumber(state, stuck.numberId).status === "active", 4000);
      const num = findNumber(state, stuck.numberId);
      assert.equal(num.status, "active");
      assert.equal(num.e164, ORDERED_E164);
      assert.equal(num.providerNumberId, PROVIDER_NUMBER_ID);

      const stuckOrderKey = `order_${stuck.numberId}`;
      const stuckOrders = telnyx.orderRequests.filter((k) => k === stuckOrderKey);
      assert.equal(stuckOrders.length, 1, "genau EIN Order-Call fuer die redrive-Nummer");
      assert.ok(hang.numberId, "t_hang-Zweig lief unabhaengig durch (Aufraeum-Kontrolle)");
    } finally {
      await app.close();
    }
  });
});

function seedTooOldStuck() {
  const s = makeDefaultState();
  s.tenants = [{ id: "t_old", status: TENANT_STATUS.ACTIVE, kycLevel: KYC_LEVEL.CARD, ownerName: "Old Tester" }];
  s.numbers = [
    {
      id: "num_old_stuck",
      tenantId: "t_old",
      status: NUMBER_STATUS.REQUESTED,
      e164: null,
      provider: PROVIDER.TELNYX,
      country: "DE",
      providerNumberId: null,
    },
  ];
  s.provisioningJobs = [
    {
      id: "job_old_stuck",
      numberId: "num_old_stuck",
      tenantId: "t_old",
      kind: PROVISION_NUMBER_JOB,
      status: PROVISIONING_JOB_STATUS.QUEUED,
      idempotencyKey: "provision_num_old_stuck",
      attempts: 0,
      lastError: null,
      createdAt: new Date(Date.now() - 2 * ONE_HOUR_MS).toISOString(),
    },
  ];
  return s;
}

test("needs_manual_reconcile: 409 + Runbook-Message bei zu altem stuck-Job, KEIN Kauf", async (t) => {
  const telnyx = await startHangableTelnyxMock(t);
  await withTelnyxMock(telnyx.url, async () => {
    const state = seedTooOldStuck();
    const { store, orchestrator, config: cfg } = buildOrchestrator(state);
    const app = await startRetryApp({ store, orchestrator, config: cfg });
    try {
      const res = await retry(app, "t_old");
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.match(json.error, /Haengender Nummernkauf/, "Runbook-Hinweis (PROV-01) in der Antwort");
      assert.match(json.error, /Auto-Retry/);
      assert.equal(telnyx.orderRequests.length, 0, "kein Kauf-Versuch");
      assert.equal(
        findNumber(state, "num_old_stuck").status,
        "requested",
        "Nummer bleibt unangetastet",
      );
    } finally {
      await app.close();
    }
  });
});

let echterSpeicher = null;

async function echterJsonSpeicher() {
  if (echterSpeicher) return echterSpeicher;
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "prov01-nie1-"));
  after(() => fs.rmSync(verzeichnis, { recursive: true, force: true }));
  config.server.dataDir = verzeichnis;
  const store = await import("../src/store.js");
  store.load();
  const datei = path.join(verzeichnis, "store.json");
  if (!fs.existsSync(datei)) throw new Error("Testaufbau: der Store schreibt nicht in das Wegwerf-Verzeichnis");
  echterSpeicher = { store, datei };
  return echterSpeicher;
}

function gespeicherteNummern(datei, tenantId) {
  const gespeichert = JSON.parse(fs.readFileSync(datei, "utf8"));
  return gespeichert.numbers.filter((number) => number.tenantId === tenantId);
}

function aktiverKunde(store, tenantId) {
  const state = store.load();
  registerTenant(state, tenantId, { country: "DE" });
  const tenant = state.tenants.find((eintrag) => eintrag.id === tenantId);
  tenant.status = TENANT_STATUS.ACTIVE;
  tenant.kycLevel = KYC_LEVEL.CARD;
  store.save();
}

function orchestratorAufSpeicher(store, { provisioningEnabled, queue = makeMemoryQueue() }) {
  const cfg = withConfigNamespaces({
    paymentEnabled: false,
    provisioningEnabled,
    provisioningRedriveMaxAgeMs: ONE_HOUR_MS,
    provisioningCountry: "DE",
    maxNumbers: 10,
    maxNumbersPerTenant: 5,
  });
  return verdrahteOrchestrator(store, cfg, queue);
}

test("[NIE1] Retry speichert die neue Nummer unter der Sperre dauerhaft im Store", async () => {
  const { store, datei } = await echterJsonSpeicher();
  aktiverKunde(store, "t_nie1_speichern");
  const app = await startRetryApp(orchestratorAufSpeicher(store, { provisioningEnabled: false }));
  try {
    const res = await retry(app, "t_nie1_speichern");
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.reason, "dry_run");
    assert.deepEqual(
      gespeicherteNummern(datei, "t_nie1_speichern").map((number) => [number.id, number.status]),
      [[json.numberId, NUMBER_STATUS.REQUESTED]],
      "die angefragte Nummer steht in der gespeicherten Store-Datei",
    );
  } finally {
    await app.close();
  }
});

test("[NIE1] Retry ohne neues Ergebnis (already_provisioned) schreibt den Store nicht", async () => {
  const { store, datei } = await echterJsonSpeicher();
  aktiverKunde(store, "t_nie1_vorhanden");
  store.load().numbers.push({
    id: "num_nie1_vorhanden",
    tenantId: "t_nie1_vorhanden",
    status: NUMBER_STATUS.ACTIVE,
    e164: "+15005550123",
    provider: PROVIDER.TELNYX,
    country: "US",
    providerNumberId: "num_ext_nie1",
  });
  store.save();
  const dateiVorher = fs.statSync(datei).ino;
  const app = await startRetryApp(orchestratorAufSpeicher(store, { provisioningEnabled: false }));
  try {
    const res = await retry(app, "t_nie1_vorhanden");
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /already_provisioned/);
    assert.equal(fs.statSync(datei).ino, dateiVorher, "kein Speichern ohne Ergebnis, das gespeichert werden muss");
    assert.deepEqual(
      gespeicherteNummern(datei, "t_nie1_vorhanden").map((number) => number.id),
      ["num_nie1_vorhanden"],
    );
  } finally {
    await app.close();
  }
});

test("[NIE1] Fehler beim Einreihen in die Queue ergibt 503 persist_error an POST /api/onboard/retry", async (t) => {
  t.mock.method(console, "error", () => {});
  const { store } = await echterJsonSpeicher();
  aktiverKunde(store, "t_nie1_queue");
  const queue = makeMemoryQueue();
  queue.enqueue = async () => {
    throw new Error("Queue nicht erreichbar");
  };
  const app = await startRetryApp(orchestratorAufSpeicher(store, { provisioningEnabled: true, queue }));
  try {
    const res = await retry(app, "t_nie1_queue");
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /persist_error/);
  } finally {
    await app.close();
  }
});

test("[NIE1] Fehler unter der Store-Sperre ergibt 503 persist_error samt Logzeile [webhook-provision]", async (t) => {
  const fehlerLog = t.mock.method(console, "error", () => {});
  const { store, datei } = await echterJsonSpeicher();
  aktiverKunde(store, "t_nie1_sperre");
  fs.rmSync(datei);
  fs.mkdirSync(datei);
  const app = await startRetryApp(orchestratorAufSpeicher(store, { provisioningEnabled: false }));
  try {
    const res = await retry(app, "t_nie1_sperre");
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /persist_error/);
    const zeilen = fehlerLog.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
    assert.ok(
      zeilen.some((zeile) => zeile.startsWith("[webhook-provision]")),
      `Logzeile mit Präfix [webhook-provision] fehlt: ${JSON.stringify(zeilen)}`,
    );
  } finally {
    await app.close();
    fs.rmSync(datei, { recursive: true, force: true });
    store.save();
  }
});
