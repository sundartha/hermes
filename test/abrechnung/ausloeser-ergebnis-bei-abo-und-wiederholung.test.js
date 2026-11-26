import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { config } from "../../src/config.ts";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../../src/billing/webhook.ts";
import { provisionAuditDetail, provisionCleared } from "../../src/billing/provision-outcome.ts";
import { makeOnboardRoutes } from "../../src/routes/api-onboard.js";
import { mitRoutenServer, postJson } from "../anrufe/routen-server.js";
import { operatorAuthPassThrough } from "../operator-route-app.js";

config.server.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ausloeser-ergebnis-"));
const speicher = await import("../../src/store.js");

const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const AUFTRAG = Object.freeze({ reason: "redrive", numberId: "num_ausloeser", jobId: "job_ausloeser" });

async function wiederholung(tenantId, ergebnis) {
  speicher.load().tenants.push({ id: tenantId, status: "active", kycLevel: "card" });
  const protokoll = [];
  const router = makeOnboardRoutes({
    store: speicher,
    config,
    audit: (aktion, _anfrage, detail) => protokoll.push([aktion, detail]),
    provisioning: { triggerTenantProvisioning: async () => ergebnis },
    operatorAuth: operatorAuthPassThrough(),
  });
  return mitRoutenServer(router, async (basis) => {
    const antwort = await postJson(`${basis}/api/onboard/retry`, { tenantId });
    return { status: antwort.status, text: await antwort.text(), protokoll };
  });
}

test("Der Ausgang des Nummern-Ausloesers entscheidet ueber Klaerung und Pruefprotokoll-Zeile", () => {
  const faelle = [
    [{ ok: true, wert: { reason: "queued" } }, true, "provision=queued"],
    [{ ok: false, fehler: "already_provisioned" }, true, "provision=already_provisioned"],
    [{ ok: false, fehler: "global_cap" }, false, "provision=withheld:global_cap"],
    [{ ok: false, fehler: { reason: "tenant_cap" } }, false, "provision=withheld:tenant_cap"],
    [{ ok: true, wert: {} }, false, "provision=none"],
    [null, false, "provision=none"],
    [undefined, false, "provision=none"],
  ];
  for (const [ergebnis, geklaert, zeile] of faelle) {
    assert.equal(provisionCleared(ergebnis), geklaert, JSON.stringify(ergebnis));
    assert.equal(provisionAuditDetail(ergebnis), zeile, JSON.stringify(ergebnis));
  }
});

test("Ein bezahltes Abo mit zurueckgehaltener Nummer bleibt unaktiviert und nennt den Grund im Pruefprotokoll", async () => {
  const tenant = "t_ausloeser_abo";
  speicher.bootstrapTenant("+493055500901", tenant);
  const protokoll = [];
  const ausgang = await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.CREATED,
      data: { object: { id: "sub_ausloeser", status: "active", metadata: { tenant_ref: tenant, plan_slug: "starter" } } },
    },
    {
      store: speicher,
      accounts: { setStatus: async () => {} },
      sessions: { invalidateByTenant: async () => {} },
      audit: (aktion, _anfrage, detail) => protokoll.push([aktion, detail]),
      req: {},
      provision: async () => ({ ok: false, fehler: "global_cap" }),
      billing: undefined,
    },
  );
  await speicher.drainFlushes();
  assert.equal(ausgang.activated, false);
  assert.match(ausgang.alarm.detail, /^tenant=t_ausloeser_abo provision=withheld:global_cap$/);
  const [, zeile] = protokoll.find(([aktion]) => aktion === "stripe_webhook_activate");
  assert.match(zeile, / provision=withheld:global_cap /);
});

test("Eine gelungene Wiederholung antwortet mit Nummer, Grund und Auftrag wie bisher", async () => {
  const tenant = "t_ausloeser_gelungen";
  const antwort = await wiederholung(tenant, { ok: true, wert: AUFTRAG });
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(
    antwort.text,
    `{"tenantId":"${tenant}","numberId":"num_ausloeser","reason":"redrive","jobId":"job_ausloeser"}`,
  );
  assert.deepEqual(antwort.protokoll, [["onboard_retry", `tenant=${tenant} ok=true grund=redrive`]]);
});

test("Eine abgelehnte Wiederholung antwortet mit Status und Grund wie bisher", async () => {
  const tenant = "t_ausloeser_abgelehnt";
  const antwort = await wiederholung(tenant, { ok: false, fehler: "global_cap" });
  assert.equal(antwort.status, HTTP_TOO_MANY_REQUESTS);
  assert.equal(antwort.text, '{"error":"Re-Provisioning abgelehnt (global_cap)"}');
  assert.deepEqual(antwort.protokoll, [["onboard_retry", `tenant=${tenant} ok=false grund=global_cap`]]);
});
