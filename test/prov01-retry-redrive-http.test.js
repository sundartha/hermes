// PROV-01 (F7): HTTP-Wiring von POST /api/onboard/retry, das resolveProvisionRetry NUR
// unit-testet (prov01-retry-redrive.test.js). Hier: die Verdrahtung selbst End-to-End -
// (1) der redrive-Zweig (`if (reqRes.reason === "redrive")` + die numberId-Ternary) und
// (2) der needs_manual_reconcile-Zweig (409 + RETRY_REASON_MESSAGE).
//
// AUTH-P6: /api/onboard/retry ist seither eine Betreiber-Route (webAuthMw+adminMw, nur
// MIT operatorAuth gemountet) - migriert auf In-Process-Mount von makeOnboardRoutes MIT
// dem ECHTEN Provisioning-Orchestrator (makeProvisioningOrchestrator, dieselbe Factory
// wie server.js) + dem ECHTEN Telnyx-Adapter (numberProvisioning) gegen den lokalen
// HTTP-Mock. Der Seed-Schritt "Tenant via POST /api/onboard anlegen" wird durch direkte
// registerTenant/requestNumber/queueProvisioning-Aufrufe ersetzt (Setup, nicht Subjekt -
// das Subjekt bleibt allein POST /api/onboard/retry, jetzt via In-Process-App gemountet).
//
// Race mit dem Boot-Sweep (F5, reconcileOrphanedProvisioning) entfaellt hier: es gibt
// keinen Boot-Sweep ohne echten Server-Boot - der stuck-Zustand entsteht daher weiterhin
// ueber den echten single-flight-Drain (F3), NICHT ueber einen beim Start bereits
// geseedeten Job (dieselbe Begruendung wie im Bestand, nur ohne den Boot-Anteil).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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

// Telnyx-Mock, dessen ERSTE Nummernsuche absichtlich haengt (kein res.end, bis release()
// aufgerufen wird) - simuliert einen Provider-Call, der noch laeuft, waehrend der
// single-flight-Drain (F3) dadurch fuer JEDEN weiteren Job besetzt bleibt. Jede weitere
// Suche antwortet sofort. orderRequests zeichnet den Idempotency-Key jeder Order auf
// (Beweis "kein Doppelkauf": derselbe Key darf nur einmal bestellen).
async function startHangableTelnyxMock() {
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
          heldRes = res; // haengt bis release()
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
      res.end(JSON.stringify({ data: {} })); // release u.a.
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
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
}

// Der Telnyx-Adapter (src/telephony/adapters/telnyx/numbers.js) liest apiKey/apiBase/
// connectionId vom ECHTEN config-Singleton (nicht vom Config-Double, das an
// makeOnboardRoutes/makeProvisioningOrchestrator geht) - Muster withStripeMock
// (test/prov01-capture-idempotent.test.js). Save/Restore haelt den Test unabhaengig
// (F.I.R.S.T.).
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

// Der ECHTE Provisioning-Orchestrator (makeProvisioningOrchestrator, dieselbe Factory wie
// server.js) auf einem Store-Double + der ECHTEN Memory-Queue. paymentEnabled bleibt
// false (PROVISION_ENV im Bestand setzte nie PAYMENT_ENABLED) - Hold/Capture bleiben
// darum unberuehrt, byte-identisch zum Bestandsverhalten.
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
    provisioningEnabled: true, // sonst kurzschliesst der Dry-Run-Zweig VOR jeder Redrive-Pruefung
    provisioningRedriveMaxAgeMs: ONE_HOUR_MS,
    provisioningCountry: "DE",
    forceNumberCountry: "",
    maxNumbers: 10,
    maxNumbersPerTenant: 5,
    ...configOverrides,
  });
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: cfg,
    queue: makeMemoryQueue(),
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
  fetch(`${app.base}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId }),
  });

// Setup-Helfer (ersetzt "Tenant via POST /api/onboard anlegen"): registerTenant +
// requestNumber DIREKT auf dem State, dann der ECHTE Orchestrator-Enqueue + fire-and-
// forget Drain-Anstoss - exakt das, was POST /api/onboard intern tut (api-onboard.js),
// nur ohne den HTTP-/Route-Umweg (Setup, nicht Subjekt dieses Tests).
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

test("redrive-Erfolg: 200, reason=redrive, jobId gesetzt, danach GENAU EIN Kauf (kein Doppelkauf)", async () => {
  const telnyx = await startHangableTelnyxMock();
  await withTelnyxMock(telnyx.url, async () => {
    const state = makeDefaultState();
    const { store, orchestrator, config: cfg } = buildOrchestrator(state);

    // t_hang besetzt den single-flight-Drain: seine Nummernsuche haengt absichtlich.
    const hang = await seedAndEnqueue(state, orchestrator, "t_hang");
    await until(() => telnyx.searchCount() >= 1, 4000); // Drain ist jetzt busy (haengt)

    // t_stuck fragt WAEHREND des haengenden Drains seine Nummer an - der Job bleibt
    // 'queued', die Nummer 'requested' (der Drain kommt nicht dazu, sie zu bearbeiten).
    // Geld-Safety des Retry-Gates braucht einen active+CARD Subscriber.
    const stuck = await seedAndEnqueue(state, orchestrator, "t_stuck");
    state.tenants.find((t) => t.id === "t_stuck").status = TENANT_STATUS.ACTIVE;
    state.tenants.find((t) => t.id === "t_stuck").kycLevel = KYC_LEVEL.CARD;
    assert.equal(findNumber(state, stuck.numberId).status, NUMBER_STATUS.REQUESTED);
    assert.equal(telnyx.searchCount(), 1, "t_stuck wurde NICHT bearbeitet (Drain haengt noch)");

    // Der Retry-Lever findet den echten stuck-Zustand: redrive statt Neuanfrage.
    const app = await startRetryApp({ store, orchestrator, config: cfg });
    try {
      const retryRes = await retry(app, "t_stuck");
      assert.equal(retryRes.status, 200);
      const retryJson = await retryRes.json();
      assert.equal(retryJson.reason, "redrive");
      assert.equal(retryJson.numberId, stuck.numberId, "dieselbe Nummer, kein Neuanfrage");
      assert.equal(retryJson.jobId, stuck.jobId, "derselbe Job, kein Doppel-Enqueue");

      // Drain freigeben (t_hang zuerst) - danach verarbeitet die Kette auch t_stuck.
      telnyx.release();
      await until(() => findNumber(state, stuck.numberId).status === "active", 4000);
      const num = findNumber(state, stuck.numberId);
      assert.equal(num.status, "active");
      assert.equal(num.e164, ORDERED_E164);
      assert.equal(num.providerNumberId, PROVIDER_NUMBER_ID);

      // Money-Safety: fuer den redrive-Job (idempotencyKey provision_<numberId> ->
      // Telnyx-Order-Key order_<numberId>) wurde GENAU EINE Order aufgegeben - der Retry
      // hat den bestehenden Job nachgefuehrt, NICHT einen zweiten Kauf ausgeloest.
      const stuckOrderKey = `order_${stuck.numberId}`;
      const stuckOrders = telnyx.orderRequests.filter((k) => k === stuckOrderKey);
      assert.equal(stuckOrders.length, 1, "genau EIN Order-Call fuer die redrive-Nummer");
      assert.ok(hang.numberId, "t_hang-Zweig lief unabhaengig durch (Aufraeum-Kontrolle)");
    } finally {
      await app.close();
    }
  });
  await telnyx.close();
});

// Alters-Gate (redriveAgeHoldReason) ist geteilt mit dem Boot-Sweep (F5): ein zu alter
// Job wird von BEIDEN unabhaengig als 'hold' klassifiziert - keine Race, direkt seedbar.
// Beweist die RETRY_REASON_STATUS/MESSAGE-Verdrahtung (409 + Runbook-Text).
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
      createdAt: new Date(Date.now() - 2 * ONE_HOUR_MS).toISOString(), // > maxAgeMs (1h)
    },
  ];
  return s;
}

test("needs_manual_reconcile: 409 + Runbook-Message bei zu altem stuck-Job, KEIN Kauf", async () => {
  const telnyx = await startHangableTelnyxMock(); // hier nur als schlichter Recorder genutzt
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
  await telnyx.close();
});
