import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { makeOnboardRoutes } from "../../src/routes/api-onboard.js";
import { speicherBereiche } from "../../src/store.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.ts";
import { tenantIdForSubject } from "../../src/begriffe/mandant.js";
import { operatorAuthPassThrough } from "../operator-route-app.js";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";
const SPALTEN_SQL = `SELECT number_provision_skip_reason, number_provision_skip_at, number_release_pending,
  workos_delete_pending, cancellation_mail_pending, cancellation_mail_received_at FROM tenant WHERE id = $1`;
const GLOBALE_DECKE = "global_cap";
const ABGEBROCHEN = "needs_manual_reconcile";
const EINGANG = "2026-11-18T10:00:00.000Z";

function runnerFuer(db, vorQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(runner) {
  const speicher = makePgStoreMitSperre(runner);
  await speicher.init();
  return speicher;
}

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
await instanz(runnerFuer(gemeinsam));
let laufendeNummer = 0;

const konfiguration = (maxNumbers) =>
  withConfigNamespaces({
    ...OHNE_EL_ZUGANG,
    provisioningEnabled: false,
    geoEnabled: false,
    provisioningCountry: "DE",
    forceNumberCountry: "",
    maxNumbers,
    maxNumbersPerTenant: 5,
  });

async function zweiInstanzen(vorQuery, zeilenSpalten = "") {
  laufendeNummer += 1;
  const sub = `sub-rest-${laufendeNummer}`;
  const tenant = tenantIdForSubject(sub);
  await gemeinsam.query(`INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')`, [tenant]);
  if (zeilenSpalten) await gemeinsam.query(`UPDATE tenant SET ${zeilenSpalten} WHERE id = $1`, [tenant]);
  const a = await instanz(runnerFuer(gemeinsam));
  const b = await instanz(runnerFuer(gemeinsam, vorQuery));
  return { a, b, tenant, sub };
}

async function onboard(speicher, koerper, maxNumbers) {
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: speicher,
      config: konfiguration(maxNumbers),
      audit: () => {},
      provisioning: {},
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((fertig) => {
    const s = app.listen(0, "127.0.0.1", () => fertig(s));
  });
  try {
    return await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "DE", ...koerper }),
    });
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

const gespeichert = async (tenantId) => (await gemeinsam.query(SPALTEN_SQL, [tenantId])).rows[0];

async function letzteFlushs(...speicher) {
  for (const s of speicher) {
    await s.drainFlushes();
    s.save();
    await s.drainFlushes();
  }
}

test("Kriterium 1+2: Freigabe- und WorkOS-Loesch-Vermerk von A stehen nach den letzten Flushs beider Instanzen in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setContractEndCleanupPending(tenant, { numberReleasePending: true, workosDeletePending: true });
  await letzteFlushs(a, b);

  const zeile = await gespeichert(tenant);
  assert.equal(zeile.number_release_pending, true);
  assert.equal(zeile.workos_delete_pending, true);
});

test("Kriterium 1+2: Kuendigungsmail-Vermerk samt Eingangszeit von A steht nach den letzten Flushs beider Instanzen in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setCancellationMailPending(tenant, { pending: true, receivedAt: EINGANG });
  await letzteFlushs(a, b);

  const zeile = await gespeichert(tenant);
  assert.equal(zeile.cancellation_mail_pending, true);
  assert.equal(new Date(zeile.cancellation_mail_received_at).toISOString(), EINGANG);
});

test("Kriterium 1+2: der Ueberspringgrund der globalen Decke samt Zeitpunkt aus dem Onboarding steht nach den letzten Flushs beider Instanzen in der Zeile", async () => {
  const { a, b, tenant, sub } = await zweiInstanzen();

  await onboard(a, { idpSubject: sub }, 0);
  await letzteFlushs(a, b);

  const zeile = await gespeichert(tenant);
  assert.equal(zeile.number_provision_skip_reason, GLOBALE_DECKE);
  assert.ok(zeile.number_provision_skip_at);
});

test("Kriterium 1: ein erfolgreiches Onboarding loescht den Ueberspringgrund in der Zeile", async () => {
  const { a, b, tenant, sub } = await zweiInstanzen(
    undefined,
    "number_provision_skip_reason = 'global_cap', number_provision_skip_at = now()",
  );

  assert.equal((await onboard(a, { idpSubject: sub }, 10)).status, 200);
  await letzteFlushs(a, b);

  const zeile = await gespeichert(tenant);
  assert.equal(zeile.number_provision_skip_reason, null);
  assert.equal(zeile.number_provision_skip_at, null);
});

test("Kriterium 1+2: der Abbruch-Vermerk zum Nummernkauf von A steht nach den letzten Flushs beider Instanzen in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  await speicherBereiche(a).nummernkauf.markTenantNeedsManualReconcile(tenant);
  await letzteFlushs(a, b);

  const zeile = await gespeichert(tenant);
  assert.equal(zeile.number_provision_skip_reason, ABGEBROCHEN);
  assert.ok(zeile.number_provision_skip_at);
});

test("Kriterium 1+2: der Ueberspringgrund aus dem Webhook-Nummernkauf von A steht nach den letzten Flushs beider Instanzen in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  const orchestrator = makeProvisioningOrchestrator({
    store: a,
    config: withConfigNamespaces({ paymentEnabled: false, provisioningEnabled: false }),
    queue: {},
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: async () => ({}),
    resolveProvisionRetry: (zustand) => {
      const mandant = zustand.tenants.find((eintrag) => eintrag.id === tenant);
      mandant.numberProvisionSkipReason = GLOBALE_DECKE;
      mandant.numberProvisionSkipAt = EINGANG;
      return { ok: false, fehler: GLOBALE_DECKE };
    },
    audit: () => {},
    recordProvisioningJob: () => null,
    markProvisioningJob: () => null,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: () => null,
  });

  await orchestrator.triggerTenantProvisioning(tenant);
  await letzteFlushs(a, b);

  assert.equal((await gespeichert(tenant)).number_provision_skip_reason, GLOBALE_DECKE);
});

test("Kriterium 2: ein letzter Flush der veralteten Instanz setzt vorhandene Vermerke nicht auf NULL oder false zurueck", async () => {
  const { b, tenant } = await zweiInstanzen();
  await gemeinsam.query(
    `UPDATE tenant SET number_release_pending = true, workos_delete_pending = true, cancellation_mail_pending = true,
       cancellation_mail_received_at = $2, number_provision_skip_reason = 'global_cap', number_provision_skip_at = $2 WHERE id = $1`,
    [tenant, EINGANG],
  );

  await letzteFlushs(b);

  const zeile = await gespeichert(tenant);
  assert.equal(zeile.number_release_pending, true);
  assert.equal(zeile.workos_delete_pending, true);
  assert.equal(zeile.cancellation_mail_pending, true);
  assert.equal(new Date(zeile.cancellation_mail_received_at).toISOString(), EINGANG);
  assert.equal(zeile.number_provision_skip_reason, GLOBALE_DECKE);
  assert.ok(zeile.number_provision_skip_at);
});

test("Kriterium 3: scheitert das gezielte Schreiben der Vermerke, steht der Fehler im Log und der Aufrufer bekommt keinen", async (t) => {
  const zustand = { kaputt: false };
  const { b, tenant } = await zweiInstanzen((text) => {
    if (zustand.kaputt && /^UPDATE tenant SET (number_release_pending|cancellation_mail_pending)/.test(text))
      throw new Error("Datenbank weg");
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  b.setContractEndCleanupPending(tenant, { numberReleasePending: true });
  b.setCancellationMailPending(tenant, { pending: true });
  await b.drainFlushes();

  const gemeldet = fehlerausgabe.mock.calls.filter(
    (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
  );
  assert.equal(gemeldet.length, 2);
});

test("Kriterium 3: nur die gesetzten Vermerke eines Teil-Patches werden geschrieben", async () => {
  const abfragen = [];
  const { b, tenant } = await zweiInstanzen((text) => abfragen.push(text));

  b.setContractEndCleanupPending(tenant, { workosDeletePending: true });
  b.setCancellationMailPending(tenant, { receivedAt: EINGANG });
  await b.drainFlushes();

  const gezielt = abfragen.filter((text) => /^UPDATE tenant SET/.test(text));
  assert.equal(gezielt.length, 2);
  assert.ok(/SET workos_delete_pending = \$2 WHERE/.test(gezielt[0]));
  assert.ok(/SET cancellation_mail_received_at = \$2 WHERE/.test(gezielt[1]));
});

test("Kriterium 3: ein Aufruf ohne Patch wirft nicht, gibt den Mandanten zurueck und laesst die Zeile unveraendert", async () => {
  const abfragen = [];
  const { a, b, tenant } = await zweiInstanzen(
    (text) => abfragen.push(text),
    "number_release_pending = true, cancellation_mail_pending = true",
  );
  await b.tenantExists(tenant);

  const aufraeumen = b.setContractEndCleanupPending(tenant, undefined);
  const kuendigung = b.setCancellationMailPending(tenant, undefined);
  await b.drainFlushes();

  assert.equal(aufraeumen?.id, tenant);
  assert.equal(kuendigung?.id, tenant);
  assert.equal(abfragen.filter((text) => /^UPDATE tenant SET/.test(text)).length, 0);
  await letzteFlushs(a);
  const zeile = await gespeichert(tenant);
  assert.equal(zeile.number_release_pending, true);
  assert.equal(zeile.cancellation_mail_pending, true);
});

test("Kriterium 3: ein Patch ohne bekanntes Feld loest keinen Schreibzugriff auf die Mandantenzeile aus", async (t) => {
  const abfragen = [];
  const { a, b, tenant } = await zweiInstanzen(
    (text) => abfragen.push(text),
    "workos_delete_pending = true, cancellation_mail_received_at = '2026-11-18T10:00:00.000Z'",
  );
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  b.setContractEndCleanupPending(tenant, {});
  b.setContractEndCleanupPending(tenant, { unbekannt: true });
  b.setCancellationMailPending(tenant, {});
  b.setCancellationMailPending(tenant, { unbekannt: true });
  await b.drainFlushes();

  assert.equal(abfragen.filter((text) => /^UPDATE tenant SET/.test(text)).length, 0);
  assert.equal(fehlerausgabe.mock.calls.length, 0);
  await letzteFlushs(a);
  const zeile = await gespeichert(tenant);
  assert.equal(zeile.workos_delete_pending, true);
  assert.equal(new Date(zeile.cancellation_mail_received_at).toISOString(), EINGANG);
});

test("Kriterium 1+2: ein Webhook-Nummernkauf mit nicht zu speicherndem Ergebnis schreibt die Vermerke nicht in die Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  const vorher = (await gespeichert(tenant)).number_provision_skip_reason;
  const original = a.stammdatenSchreiben;
  let schreibAufrufe = 0;
  a.stammdatenSchreiben = (...args) => {
    schreibAufrufe += 1;
    return original?.apply(a, args);
  };
  const orchestrator = makeProvisioningOrchestrator({
    store: a,
    config: withConfigNamespaces({ paymentEnabled: false, provisioningEnabled: false }),
    queue: {},
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: async () => ({}),
    resolveProvisionRetry: (zustand) => {
      const mandant = zustand.tenants.find((eintrag) => eintrag.id === tenant);
      mandant.numberProvisionSkipReason = "tenant_cap";
      mandant.numberProvisionSkipAt = EINGANG;
      return { ok: false, fehler: "tenant_cap" };
    },
    audit: () => {},
    recordProvisioningJob: () => null,
    markProvisioningJob: () => null,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: () => null,
  });

  await orchestrator.triggerTenantProvisioning(tenant);
  await letzteFlushs(a, b);

  assert.equal(vorher, null);
  assert.equal((await gespeichert(tenant)).number_provision_skip_reason, vorher);
  assert.equal(schreibAufrufe, 0);
});
