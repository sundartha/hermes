import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { operatorAuthPassThrough } from "../operator-route-app.js";

const TOKEN = "t".repeat(20);
const BENUTZER = "123456";
const HTTP_OK = 200;
const HTTP_ZU_VIELE = 429;
const HTTP_FEHLER = 500;
const NUMMER = "+12025550100";
const FEHLERTITEL = "Kaufsperre fuer Kunde Mustermann";
const FEHLERDETAIL = "Bestellung abgelehnt wegen Konto 4711";
const ZAEHLER = "hermes.anbieter.aufrufe";
const TENANT = "t_nummernkauf";

let bestellAntwort = { status: HTTP_OK, koerper: {} };
const telnyxStub = http.createServer((req, res) => {
  req.resume();
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/v2/available_phone_numbers"))
    return res.end(JSON.stringify({ data: [{ phone_number: NUMMER }] }));
  if (req.url === "/v2/number_orders" && req.method === "POST") {
    res.statusCode = bestellAntwort.status;
    return res.end(JSON.stringify(bestellAntwort.koerper));
  }
  res.end(JSON.stringify({ data: {} }));
});
await new Promise((bereit) => telnyxStub.listen(0, "127.0.0.1", bereit));
process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyxStub.address().port}`;
process.env.TELNYX_API_KEY = "KEYtest-nummernkauf";

const { withConfigNamespaces } = await import("../config-namespaces-helper.js");
const { fakeBilling } = await import("../helpers.js");
const { makePgTestStore } = await import("../pg-helpers.js");
const { starteTelemetrie } = await import("../../src/utils/telemetrie.js");
const { makeOnboardRoutes } = await import("../../src/routes/api-onboard.js");
const { makeProvisioningOrchestrator } = await import("../../src/worker/provisioning-orchestrator.js");
const { handleProvisionJob } = await import("../../src/worker/provisioning.js");
const { numberProvisioning } = await import("../../src/telephony/registry.js");
const { createQueue } = await import("../../src/queue/registry.js");
const { PAYMENT_METHOD_TYPE_CARD } = await import("../../src/billing/payment-method-eligibility.js");
const { NUMBER_STATUS } = await import("../../src/store.js");

after(() => new Promise((fertig) => telnyxStub.close(fertig)));

function startEmpfaenger() {
  const empfangen = [];
  const empfaenger = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      empfangen.push(JSON.parse(Buffer.concat(teile).toString("utf8")));
      res.writeHead(HTTP_OK, { "content-type": "application/json" }).end("{}");
    });
  });
  return new Promise((resolve) => {
    empfaenger.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${empfaenger.address().port}/otlp`;
      resolve({ url, empfangen, stop: () => new Promise((fertig) => empfaenger.close(fertig)) });
    });
  });
}

const attribute = (punkt) => Object.fromEntries(punkt.attributes.map((a) => [a.key, a.value.stringValue]));
const zaehlerPunkte = (exporte) =>
  exporte
    .slice(-1)
    .flatMap((e) =>
      e.resourceMetrics.flatMap((r) =>
        r.scopeMetrics.flatMap((s) => s.metrics.filter((m) => m.name === ZAEHLER)),
      ),
    )
    .flatMap((m) => m.sum.dataPoints.map((p) => ({ ...attribute(p), wert: Number(p.asInt ?? p.asDouble) })));
const kaufPunkte = (exporte) => zaehlerPunkte(exporte).filter((p) => p.vorgang === "nummer-kaufen");

async function mitTelemetrie(lauf) {
  const empfaenger = await startEmpfaenger();
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    benutzer: BENUTZER,
    token: TOKEN,
    instanzKennung: "instanz-test",
    version: "test",
    intervallMs: 3_600_000,
  });
  try {
    return await lauf({ telemetrie, empfaenger });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
  }
}

async function aufbau() {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({
    id: TENANT,
    status: "active",
    stripeCustomerId: "cus_1",
    stripePaymentMethodId: "pm_1",
    stripePaymentMethodType: PAYMENT_METHOD_TYPE_CARD,
  });
  const billing = fakeBilling();
  const jobMarkierungen = [];
  const cfg = withConfigNamespaces({
    paymentEnabled: true,
    numberSetupFeeCents: 500,
    paymentCurrency: "eur",
    provisioningEnabled: true,
    provisioningRedriveMaxAgeMs: 3_600_000,
    provisioningCountry: "US",
    forceNumberCountry: "",
    geoEnabled: false,
    maxNumbers: 10,
    maxNumbersPerTenant: 1,
    defaultTenantBudgetCents: 0,
  });
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: cfg,
    queue: createQueue(),
    billing,
    metering: { recordNumberMonthMeter() {}, recordDueNumberMonthMeters: () => ({}) },
    numberProvisioning,
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: (s, { numberId, tenantId, idempotencyKey }) => {
      const job = { id: `job_${numberId}`, numberId, tenantId, idempotencyKey };
      s.provisioningJobs.push(job);
      return job;
    },
    markProvisioningJob: (_s, jobId, status, lastError) => jobMarkierungen.push({ jobId, status, lastError }),
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: (s, id) => s.numbers.find((n) => n.id === id) ?? null,
  });
  return { state, store, billing, cfg, orchestrator, jobMarkierungen };
}

async function onboardMitKauf(antwort) {
  bestellAntwort = antwort;
  const { state, store, billing, cfg, orchestrator, jobMarkierungen } = await aufbau();
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store,
      config: cfg,
      audit: () => {},
      provisioning: orchestrator,
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const l = app.listen(0, "127.0.0.1", () => r(l));
  });
  try {
    return await mitTelemetrie(async ({ telemetrie, empfaenger }) => {
      const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT }),
      });
      const koerper = await res.json();
      await orchestrator.runProvisioningDrainExclusive();
      await telemetrie.spuele();
      return { state, billing, jobMarkierungen, status: res.status, koerper, exporte: empfaenger.empfangen };
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("S10: ein 429 mit Telnyx-Code 10011 beim Nummernkauf ueber POST /api/onboard zaehlt nummer-kaufen/429 genau einmal", async () => {
  const { status, koerper, exporte } = await onboardMitKauf({
    status: HTTP_ZU_VIELE,
    koerper: { errors: [{ code: "10011", title: "Rate limit" }] },
  });
  assert.equal(status, HTTP_OK);
  assert.equal(koerper.provisioning, "queued");
  assert.deepEqual(kaufPunkte(exporte), [
    { anbieter: "telnyx", vorgang: "nummer-kaufen", ergebnis: "429", wert: 1 },
  ]);
});

test("B9/R3: ein 500 beim Kauf laesst Nummer und Job scheitern wie ohne Messung, storniert den Hold und zaehlt fehler ohne Inhalte im Export", async () => {
  const { state, billing, jobMarkierungen, exporte } = await onboardMitKauf({
    status: HTTP_FEHLER,
    koerper: { errors: [{ code: "20000", title: FEHLERTITEL, detail: FEHLERDETAIL }] },
  });
  const nummer = state.numbers.find((n) => n.tenantId === TENANT);
  assert.equal(nummer.status, NUMBER_STATUS.FAILED);
  assert.deepEqual(jobMarkierungen, [
    {
      jobId: `job_${nummer.id}`,
      status: "failed",
      lastError: `Telnyx orderNumber fehlgeschlagen: HTTP ${HTTP_FEHLER} (20000 ${FEHLERTITEL}: ${FEHLERDETAIL})`,
    },
  ]);
  assert.deepEqual(
    billing.log.map((e) => e[0]),
    ["placeHold", "cancelHold"],
  );
  assert.deepEqual(kaufPunkte(exporte), [
    { anbieter: "telnyx", vorgang: "nummer-kaufen", ergebnis: "fehler", wert: 1 },
  ]);
  const text = JSON.stringify(exporte);
  for (const verboten of [NUMMER, FEHLERTITEL, FEHLERDETAIL, TENANT, nummer.id])
    assert.ok(!text.includes(verboten), `Export enthaelt ${verboten}`);
});
