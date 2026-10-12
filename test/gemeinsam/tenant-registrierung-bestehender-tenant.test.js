import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NUMMER_A = "+4915112345678";
const NUMMER_B = "+4915187654321";

let store;
let app;
let server;
let base;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-test-"));
  const { operatorAuthPassThrough } = await import("../operator-route-app.js");
  const { withConfigNamespaces } = await import("../config-namespaces-helper.js");
  store = await import("../../src/store.js");
  const { makeOnboardRoutes } = await import("../../src/routes/api-onboard.js");
  app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      operatorAuth: operatorAuthPassThrough(),
      store,
      provisioning: {
        queueProvisioning: async () => ({ ok: true, jobId: "job_test1" }),
        runProvisioningDrainExclusive: async () => {},
      },
      audit: () => {},
      config: withConfigNamespaces({
        defaultTenantBudgetCents: 0,
        geoEnabled: false,
        forceNumberCountry: "",
        provisioningCountry: "DE",
        provisioningEnabled: false,
        maxNumbersPerTenant: 10,
        maxNumbers: 100,
      }),
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

const onboard = (body) =>
  fetch(`${base}/api/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function tenantVon(id) {
  return store.load().tenants.filter((t) => t.id === id);
}

test("Erneute Registrierung ergaenzt fehlende idpSubject am bestehenden Tenant", async () => {
  await onboard({ tenantId: "t_sub-ergaenzt" });
  assert.equal(store.tenantIdpSubject("t_sub-ergaenzt"), null);
  await onboard({ idpSubject: "sub-ergaenzt" });
  assert.equal(tenantVon("t_sub-ergaenzt").length, 1);
  assert.equal(tenantVon("t_sub-ergaenzt")[0].idpSubject, "sub-ergaenzt");
});

test("Erneute Registrierung ueberschreibt vorhandene idpSubject nicht", async () => {
  store.load().tenants.push({ id: "t_sub-neu", status: "active", idpSubject: "sub-alt" });
  await onboard({ idpSubject: "sub-neu" });
  assert.equal(tenantVon("t_sub-neu").length, 1);
  assert.equal(tenantVon("t_sub-neu")[0].idpSubject, "sub-alt");
});

test("Erneute Registrierung setzt fehlende Privatnummer am bestehenden Tenant", async () => {
  await onboard({ tenantId: "t_nr1", country: "DE" });
  assert.equal(store.tenantPrivateNumber("t_nr1"), null);
  await onboard({ tenantId: "t_nr1", privateNumber: NUMMER_A, country: "DE" });
  assert.equal(tenantVon("t_nr1").length, 1);
  assert.equal(tenantVon("t_nr1")[0].privateNumber, NUMMER_A);
  assert.equal(store.tenantPrivateNumber("t_nr1"), NUMMER_A);
});

test("Erneute Registrierung ueberschreibt vorhandene Privatnummer nicht", async () => {
  await onboard({ tenantId: "t_nr2", privateNumber: NUMMER_A, country: "DE" });
  await onboard({ tenantId: "t_nr2", privateNumber: NUMMER_B, country: "DE" });
  assert.equal(tenantVon("t_nr2")[0].privateNumber, NUMMER_A);
});

test("Erneute Registrierung ohne Nummer laesst vorhandene Privatnummer stehen", async () => {
  await onboard({ tenantId: "t_nr3", privateNumber: NUMMER_A, country: "DE" });
  await onboard({ tenantId: "t_nr3" });
  assert.equal(tenantVon("t_nr3")[0].privateNumber, NUMMER_A);
});

test("Erneute Registrierung ohne Nummer legt keinen Privatnummer-Eintrag an", async () => {
  await onboard({ tenantId: "t_leer" });
  await onboard({ tenantId: "t_leer" });
  assert.equal(tenantVon("t_leer").length, 1);
  assert.equal("privateNumber" in tenantVon("t_leer")[0], false);
});

test("Neuer Tenant ohne idpSubject traegt kein idpSubject-Feld", async () => {
  const res = await onboard({ tenantId: "t_neu" });
  assert.equal(res.status, 200);
  assert.equal("idpSubject" in tenantVon("t_neu")[0], false);
});

test("Neuer Tenant mit idpSubject speichert es", async () => {
  const res = await onboard({ idpSubject: "sub-1" });
  assert.equal(res.status, 200);
  assert.equal(tenantVon("t_sub-1")[0].idpSubject, "sub-1");
  assert.equal(store.tenantIdpSubject("t_sub-1"), "sub-1");
});

test("setPrivateNumber fuer unbekannten Tenant nennt die Tenant-ID im Fehler", () => {
  assert.throws(
    () => store.setPrivateNumber("t_unbekannt", NUMMER_A),
    /setPrivateNumber: Tenant t_unbekannt nicht gefunden/,
  );
});
