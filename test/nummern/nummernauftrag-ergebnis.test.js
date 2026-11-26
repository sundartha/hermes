import assert from "node:assert/strict";
import { test } from "node:test";

import express from "express";

import { config as basisKonfiguration } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.ts";
import { makeOnboardRoutes } from "../../src/routes/api-onboard.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.ts";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeConfigOverrides } from "../helpers.js";
import { operatorAuthPassThrough, startRouterApp } from "../operator-route-app.js";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";

const { withConfigOverrides } = makeConfigOverrides(basisKonfiguration);
const MANDANT = "t_nummernauftrag";
const NUMMER = "num_auftrag";
const NEUE_NUMMER = { id: NUMMER, tenantId: MANDANT, provider: "telnyx", status: "requested", country: "US", language: "en" };

function auftragVermerken(zustand, auftrag) {
  const vermerk = {
    ...auftrag,
    id: `job_${auftrag.numberId}`,
    kind: "provision_number",
    status: "queued",
    attempts: 0,
    lastError: null,
    createdAt: "2026-11-26T10:00:00.000Z",
  };
  zustand.provisioningJobs.push(vermerk);
  return vermerk;
}

async function aufbau(t, { auftragsspurScheitert = false } = {}) {
  t.mock.method(console, "error", () => {});
  const { store } = await makePgTestStore();
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  if (auftragsspurScheitert)
    t.mock.method(queue, "enqueue", async () => {
      throw new Error("Warteschlange nicht erreichbar");
    });
  const config = withConfigNamespaces({
    ...OHNE_EL_ZUGANG,
    paymentEnabled: false,
    provisioningEnabled: true,
    provisioningCountry: "DE",
    forceNumberCountry: "",
    geoEnabled: false,
    defaultTenantBudgetCents: 0,
    maxNumbers: 5,
    maxNumbersPerTenant: 1,
  });
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config,
    queue,
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: async () => ({}),
    resolveProvisionRetry: (zustand) => {
      const number = { ...NEUE_NUMMER };
      zustand.numbers.push(number);
      return { ok: true, wert: { number } };
    },
    audit: () => {},
    recordProvisioningJob: auftragVermerken,
    markProvisioningJob: () => null,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: (zustand, id) => zustand.numbers.find((nummer) => nummer.id === id) ?? null,
  });
  return { store, config, orchestrator };
}

async function mitNummer({ store }) {
  await legeMandantAn(store, MANDANT);
  const zustand = store.load();
  zustand.numbers.push({ ...NEUE_NUMMER });
}

function angelegt({ store }) {
  const { numbers, provisioningJobs } = store.load();
  const [nummer] = numbers;
  const [auftrag] = provisioningJobs;
  return { numberId: nummer?.id, jobId: auftrag?.id };
}

async function aufnehmen(t, umgebung) {
  const pruefprotokoll = [];
  const router = express.Router();
  router.use(
    makeOnboardRoutes({
      store: umgebung.store,
      config: umgebung.config,
      audit: (aktion, _anfrage, detail) => pruefprotokoll.push([aktion, detail]),
      provisioning: umgebung.orchestrator,
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const app = await startRouterApp(router);
  t.after(app.close);
  const antwort = await abrufMitFrist(`${app.base}/api/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: MANDANT }),
  });
  return { status: antwort.status, text: await antwort.text(), pruefprotokoll };
}

test("nummernauftrag: ein angelegter Auftrag liefert ok mit der Auftragskennung als Wert", async (t) => {
  const umgebung = await aufbau(t);
  await mitNummer(umgebung);

  const ergebnis = await umgebung.orchestrator.queueProvisioning(NUMMER, MANDANT);

  const { jobId } = angelegt(umgebung);
  assert.equal(typeof jobId, "string");
  assert.deepEqual(ergebnis, { ok: true, wert: { jobId } });
});

test("nummernauftrag: scheitert die Auftragsspur, liefert der Auftrag den Fehler persist_error", async (t) => {
  const umgebung = await aufbau(t, { auftragsspurScheitert: true });
  await mitNummer(umgebung);

  const ergebnis = await umgebung.orchestrator.queueProvisioning(NUMMER, MANDANT);

  assert.deepEqual(ergebnis, { ok: false, fehler: "persist_error" });
});

test("nummernauftrag: die Aufnahme antwortet mit der Auftragskennung und schreibt sie ins Pruefprotokoll", async (t) => {
  const umgebung = await aufbau(t);

  const { status, text, pruefprotokoll } = await aufnehmen(t, umgebung);

  const { numberId, jobId } = angelegt(umgebung);
  assert.equal(typeof jobId, "string");
  assert.equal(status, 200);
  assert.equal(
    text,
    JSON.stringify({
      tenantId: MANDANT,
      numberId,
      status: "requested",
      country: "DE",
      language: "de",
      provisioning: "queued",
      jobId,
    }),
  );
  assert.deepEqual(pruefprotokoll.at(-1), ["onboard_queued", `tenant=${MANDANT} number=${numberId} job=${jobId}`]);
});

test("nummernauftrag: scheitert die Auftragsspur bei der Aufnahme, bleibt die 503-Antwort gleich", async (t) => {
  const umgebung = await aufbau(t, { auftragsspurScheitert: true });

  const { status, text, pruefprotokoll } = await aufnehmen(t, umgebung);

  assert.equal(status, 503);
  assert.equal(text, JSON.stringify({ error: "Persistenz fehlgeschlagen" }));
  const aktionen = pruefprotokoll.map(([aktion]) => aktion);
  assert.deepEqual(aktionen, ["onboard_request"]);
});

test("nummernauftrag: der Anstoss nach der Zahlung nennt die Auftragskennung des neuen Auftrags", async (t) => {
  const umgebung = await aufbau(t);
  await legeMandantAn(umgebung.store, MANDANT);

  const ergebnis = await umgebung.orchestrator.triggerTenantProvisioning(MANDANT);

  const { jobId } = angelegt(umgebung);
  assert.equal(typeof jobId, "string");
  assert.deepEqual(ergebnis, { ok: true, wert: { reason: "queued", numberId: NUMMER, jobId } });
});

test("nummernauftrag: scheitert die Auftragsspur beim Anstoss nach der Zahlung, bleibt es bei persist_error", async (t) => {
  const umgebung = await aufbau(t, { auftragsspurScheitert: true });
  await legeMandantAn(umgebung.store, MANDANT);

  const ergebnis = await umgebung.orchestrator.triggerTenantProvisioning(MANDANT);

  assert.deepEqual(ergebnis, { ok: false, fehler: "persist_error" });
});
