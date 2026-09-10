// 312k-Phase 4 (Vertragsende-Aufraeumarbeiten nach KUENDIGUNG): Rufnummer freigeben +
// WorkOS-Identitaet loeschen, AUSSCHLIESSLICH wenn cancelAtPeriodEnd VOR dem Suspend
// gesetzt war (Kuendigung), NIE bei blossem Zahlungsausfall. Reine In-Process-Units mit
// aufzeichnenden Fake-Seams, kein Netz, kein Spawn (F.I.R.S.T.) - Muster
// tenant-erasure-number-release.test.js (fakeStore/fakeProvisioner/fakeAudit),
// p3-payment-webhook.test.js/stripe-webhook-race.test.js (applyStripeWebhook-fakeDeps).
import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import {
  attemptContractEndCleanup,
  runContractEndCleanupSweep,
} from "../src/billing/contract-end-cleanup.js";
import { makeWorkosManagement } from "../src/workos-management.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";

const TENANT = "t_end";
const WORKOS_SUBJECT = "user_pii_should_never_leak_01";
const WORKOS_SECRET = "sk_workos_mgmt_should_never_leak";

// ---- geteilte Fakes -----------------------------------------------------------------

const fakeAudit = () => ({
  records: [],
  record(entry) {
    this.records.push(entry);
    return Promise.resolve();
  },
});

function fakeLogger() {
  const lines = [];
  return { lines, log: (m) => lines.push(String(m)), warn: (m) => lines.push(String(m)) };
}

// EINE mutable state-Referenz (Muster tenant-erasure-number-release.test.js) - ein Tenant
// mit einer aktiven Telnyx-Nummer + gebundener WorkOS-Identitaet.
function seedState(over = {}) {
  return {
    tenants: [{ id: TENANT, idpSubject: WORKOS_SUBJECT }],
    numbers: [
      {
        id: "n1",
        tenantId: TENANT,
        status: NUMBER_STATUS.ACTIVE,
        provider: PROVIDER.TELNYX,
        providerNumberId: "ext_1",
      },
    ],
    numberAssignments: [{ id: "a1", numberId: "n1", tenantId: TENANT, assignedAt: "x", releasedAt: null }],
    ...over,
  };
}

// Store-Fassade ueber der Kontraktflaeche, die attemptContractEndCleanup/
// releaseTenantNumbersOnErase brauchen: load/save/withStoreLock (Muster fakeStore in
// tenant-erasure-number-release.test.js) + die drei neuen 312k-Phase-4-Facaden-Methoden.
function fakeStore(s) {
  const findTenant = (tenantId) => s.tenants.find((t) => t.id === tenantId);
  return {
    load: () => s,
    save: () => {},
    withStoreLock: (fn) => fn(),
    tenantIdpSubject: (tenantId) => findTenant(tenantId)?.idpSubject ?? null,
    setContractEndCleanupPending: (tenantId, patch) => {
      const t = findTenant(tenantId);
      if (t) Object.assign(t, patch);
      return t ?? null;
    },
    tenantsPendingContractEndCleanup: () =>
      s.tenants.filter((t) => t.numberReleasePending || t.workosDeletePending),
  };
}

const successfulWorkos = () => {
  const calls = [];
  return {
    calls,
    deleteUser: async (subject) => {
      calls.push(subject);
      return { deleted: true };
    },
  };
};

// ======================================================================================
// attemptContractEndCleanup / runContractEndCleanupSweep (Orchestrator-Ebene)
// ======================================================================================

test("attemptContractEndCleanup: Happy Path - Nummer freigegeben + WorkOS geloescht, beide Marker false, durabler Audit fuer beide Teilschritte", async () => {
  const s = seedState();
  const store = fakeStore(s);
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const workos = successfulWorkos();

  const result = await attemptContractEndCleanup({
    store, numberProvisioner: prov, workos, auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });

  assert.deepEqual(result, { numberReleasePending: false, workosDeletePending: false });
  assert.equal(s.numbers[0].status, NUMBER_STATUS.RELEASED, "Nummer wurde freigegeben");
  assert.deepEqual(workos.calls, [WORKOS_SUBJECT], "WorkOS-Loeschung mit der beim Login gebundenen Identitaet");
  assert.equal(s.tenants[0].numberReleasePending, false, "am Tenant persistiert");
  assert.equal(s.tenants[0].workosDeletePending, false, "am Tenant persistiert");
  assert.ok(audit.records.some((r) => r.action === "did_released"), "Nummern-Freigabe durabel auditiert");
  assert.ok(audit.records.some((r) => r.action === "workos_user_deleted"), "WorkOS-Loeschung durabel auditiert");
});

// ---- Pflichttest 3: Schluessel nicht gesetzt -----------------------------------------

test("Pflichttest 3: WORKOS_MANAGEMENT_API_KEY nicht gesetzt -> keine Loeschung versucht, offener Vermerk, Nummer-Freigabe laeuft unabhaengig weiter", async () => {
  const s = seedState();
  const store = fakeStore(s);
  const prov = fakeProvisioner();
  const audit = fakeAudit();

  // workos=null spiegelt wireWebLogin: config.auth.workosManagementApiKey leer -> kein
  // Adapter konstruiert (s. src/wiring/web-login.js).
  const result = await attemptContractEndCleanup({
    store, numberProvisioner: prov, workos: null, auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });

  assert.equal(result.workosDeletePending, true, "Loeschung bleibt offen vermerkt");
  assert.equal(result.numberReleasePending, false, "Nummer-Freigabe ist UNABHAENGIG und lief trotzdem durch");
  assert.equal(s.numbers[0].status, NUMBER_STATUS.RELEASED);
  assert.ok(
    audit.records.some(
      (r) => r.action === "workos_user_delete_skipped" && r.detail === "reason=key_missing",
    ),
    "der uebersprungene Versuch ist durabel protokolliert",
  );
});

// ---- Pflichttest 4: WorkOS-Fehler -> Retry durch den Sweep ---------------------------

test("Pflichttest 4: WorkOS antwortet mit Fehler -> Vermerk bleibt offen, spaeterer Sweep versucht erneut und erfolgreich", async () => {
  const s = seedState();
  const store = fakeStore(s);
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  let attempts = 0;
  const flakyWorkos = {
    deleteUser: async () => {
      attempts++;
      if (attempts === 1) throw new Error("workos_management deleteUser HTTP 500");
      return { deleted: true };
    },
  };

  const first = await attemptContractEndCleanup({
    store, numberProvisioner: prov, workos: flakyWorkos, auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });
  assert.equal(first.workosDeletePending, true, "erster Versuch scheitert -> offen");
  assert.equal(s.tenants[0].workosDeletePending, true, "am Tenant offen vermerkt");
  assert.deepEqual(
    store.tenantsPendingContractEndCleanup().map((t) => t.id),
    [TENANT],
    "Selektor findet den Tenant fuer den naechsten Sweep",
  );
  assert.ok(audit.records.some((r) => r.action === "workos_user_delete_failed"));

  const sweep = await runContractEndCleanupSweep({
    store, numberProvisioner: prov, workos: flakyWorkos, auditStore: audit, logger: fakeLogger(),
  });

  assert.equal(sweep.attempted, 1);
  assert.equal(attempts, 2, "der Sweep hat einen ZWEITEN Versuch unternommen");
  assert.equal(s.tenants[0].workosDeletePending, false, "der zweite Versuch gelang -> nicht mehr offen");
  assert.ok(audit.records.some((r) => r.action === "workos_user_deleted"));
});

// ---- Pflichttest 5: Idempotenz --------------------------------------------------------

test("Pflichttest 5: zweiter Durchlauf nach Erfolg macht nichts mehr (Idempotenz)", async () => {
  const s = seedState();
  const store = fakeStore(s);
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const workos = successfulWorkos();

  await attemptContractEndCleanup({
    store, numberProvisioner: prov, workos, auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });
  assert.deepEqual(store.tenantsPendingContractEndCleanup(), [], "kein offener Rest mehr");

  const sweep = await runContractEndCleanupSweep({
    store, numberProvisioner: prov, workos, auditStore: audit, logger: fakeLogger(),
  });

  assert.equal(sweep.attempted, 0, "der Selektor liefert leer -> der Sweep ruehrt den Tenant nicht an");
  assert.deepEqual(prov.log, ["release:ext_1"], "kein zweiter Provider-Call");
  assert.deepEqual(workos.calls, [WORKOS_SUBJECT], "kein zweiter WorkOS-Call");
});

// ---- Pflichttest 6: kein Schluessel/keine PII im Log ----------------------------------

test("Pflichttest 6: WorkOS-Fehlerpfad - weder die Nutzer-Kennung noch der API-Key erscheinen in Log oder Audit-Detail", async () => {
  const s = seedState();
  const store = fakeStore(s);
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const logger = fakeLogger();
  const failingWorkos = {
    deleteUser: async () => {
      throw new Error("workos_management deleteUser HTTP 500");
    },
  };

  await attemptContractEndCleanup({
    store, numberProvisioner: prov, workos: failingWorkos, auditStore: audit, logger, tenantId: TENANT,
  });

  const logText = logger.lines.join("\n");
  assert.doesNotMatch(logText, new RegExp(WORKOS_SUBJECT), "keine WorkOS-Nutzer-Kennung im Log");
  assert.doesNotMatch(logText, new RegExp(WORKOS_SECRET), "kein Schluessel im Log");

  const auditText = audit.records.map((r) => `${r.action} ${r.detail ?? ""}`).join("\n");
  assert.doesNotMatch(auditText, new RegExp(WORKOS_SUBJECT), "keine WorkOS-Nutzer-Kennung im Audit-Detail");
  assert.doesNotMatch(auditText, new RegExp(WORKOS_SECRET), "kein Schluessel im Audit-Detail");
});

// ======================================================================================
// Webhook-Ebene: die Unterscheidung Kuendigung vs. Zahlungsausfall (billing/webhook.js)
// ======================================================================================

function fakeWebhookStore(s) {
  const inner = fakeStore(s);
  const findTenant = (tenantId) => s.tenants.find((t) => t.id === tenantId);
  return {
    ...inner,
    findTenantBySubscription: () => null,
    // FW1-A: Existenz-Gate der Tenant-Aufloesung - ueber den echten State geprueft (Muster wie im Rest dieses Doubles).
    tenantExists: (tenantId) => Boolean(findTenant(tenantId)),
    setSuspendedAtIfAbsent: () => {},
    tenantSubscription: (tenantId) => ({
      planSlug: null,
      cancelAtPeriodEnd: !!findTenant(tenantId)?.cancelAtPeriodEnd,
    }),
  };
}

function deletedEvent({ id, created, subId, tenant }) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: subId, metadata: { tenant_ref: tenant } } },
  };
}

function paymentFailedEvent({ id, created, subId, tenant }) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
    data: { object: { subscription: subId, metadata: { tenant_ref: tenant } } },
  };
}

// ---- Pflichttest 1 --------------------------------------------------------------------

test("Pflichttest 1: Abo endet nach Kuendigung (cancelAtPeriodEnd war gesetzt) -> Sperre greift, Nummer wird freigegeben, WorkOS-Loeschung wird versucht", async () => {
  const s = seedState({ tenants: [{ id: TENANT, idpSubject: WORKOS_SUBJECT, cancelAtPeriodEnd: true }] });
  const store = fakeWebhookStore(s);
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const workos = successfulWorkos();
  const setStatusCalls = [];
  const invalidateCalls = [];

  const outcome = await applyStripeWebhook(
    deletedEvent({ id: "evt_c1", created: 1, subId: "sub_c1", tenant: TENANT }),
    {
      store,
      accounts: { setStatus: async (t, status) => setStatusCalls.push([t, status]) },
      sessions: { invalidateByTenant: async (t) => invalidateCalls.push(t) },
      audit: () => {},
      req: {},
      provision: async () => ({}),
      billing: {},
      numberProvisioner: prov,
      workos,
      auditStore: audit,
    },
  );

  assert.deepEqual(outcome, { suspended: true });
  assert.deepEqual(setStatusCalls, [[TENANT, "suspended"]], "die Sperre greift");
  assert.deepEqual(invalidateCalls, [TENANT], "Sessions werden invalidiert");
  assert.equal(s.numbers[0].status, NUMBER_STATUS.RELEASED, "Nummer wurde freigegeben");
  assert.deepEqual(workos.calls, [WORKOS_SUBJECT], "WorkOS-Loeschung wurde versucht");
  assert.equal(s.tenants[0].numberReleasePending, false);
  assert.equal(s.tenants[0].workosDeletePending, false);
});

// ---- Pflichttest 2 (DER WICHTIGSTE TEST DIESER PHASE) ---------------------------------

test("Pflichttest 2 (wichtigster Test): Abo endet nach Zahlungsausfall OHNE vorherige Kuendigung -> Sperre greift, aber WEDER Freigabe NOCH Loeschung", async () => {
  const s = seedState({ tenants: [{ id: TENANT, idpSubject: WORKOS_SUBJECT, cancelAtPeriodEnd: false }] });
  const store = fakeWebhookStore(s);
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const workos = successfulWorkos();
  const setStatusCalls = [];
  const invalidateCalls = [];

  const outcome = await applyStripeWebhook(
    paymentFailedEvent({ id: "evt_pf1", created: 1, subId: "sub_pf1", tenant: TENANT }),
    {
      store,
      accounts: { setStatus: async (t, status) => setStatusCalls.push([t, status]) },
      sessions: { invalidateByTenant: async (t) => invalidateCalls.push(t) },
      audit: () => {},
      req: {},
      provision: async () => ({}),
      billing: {},
      numberProvisioner: prov,
      workos,
      auditStore: audit,
    },
  );

  assert.deepEqual(outcome, { suspended: true }, "die Sperre greift TROTZDEM");
  assert.deepEqual(setStatusCalls, [[TENANT, "suspended"]]);
  assert.deepEqual(invalidateCalls, [TENANT]);
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE, "Nummer bleibt AKTIV - kein Fehl-Release");
  assert.deepEqual(prov.log, [], "kein einziger Provider-Call");
  assert.deepEqual(workos.calls, [], "die WorkOS-Loeschung wird NICHT versucht");
  assert.equal(s.tenants[0].numberReleasePending, undefined, "kein Vermerk gesetzt - nie angefasst");
  assert.equal(s.tenants[0].workosDeletePending, undefined, "kein Vermerk gesetzt - nie angefasst");
  assert.ok(
    !audit.records.some((r) => r.action.startsWith("workos_") || r.action.startsWith("did_")),
    "kein einziger Aufraeum-Audit-Eintrag",
  );
});

test("Ergaenzung zu Pflichttest 2: customer.subscription.deleted OHNE vorherige Kuendigung (z.B. Karte dauerhaft gescheitert) -> ebenfalls WEDER Freigabe NOCH Loeschung", async () => {
  // Beweist: die Weiche haengt AUSSCHLIESSLICH am gespeicherten cancelAtPeriodEnd-Zustand,
  // NICHT am Stripe-Event-Typ - auch ein "deleted" ohne vorherige Kuendigung bleibt unangetastet.
  const s = seedState({ tenants: [{ id: TENANT, idpSubject: WORKOS_SUBJECT, cancelAtPeriodEnd: false }] });
  const store = fakeWebhookStore(s);
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const workos = successfulWorkos();

  const outcome = await applyStripeWebhook(
    deletedEvent({ id: "evt_d_nocancel", created: 1, subId: "sub_d_nocancel", tenant: TENANT }),
    {
      store,
      accounts: { setStatus: async () => {} },
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({}),
      billing: {},
      numberProvisioner: prov,
      workos,
      auditStore: audit,
    },
  );

  assert.deepEqual(outcome, { suspended: true });
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE);
  assert.deepEqual(workos.calls, []);
});

// ======================================================================================
// workos-management.js (Port + Adapter, Muster web-auth.test.js captureFetch)
// ======================================================================================

function captureFetch({ ok = true, status = 200 } = {}) {
  const seen = {};
  const _fetch = async (url, opts = {}) => {
    seen.url = String(url);
    seen.opts = opts;
    return { ok, status };
  };
  return { _fetch, seen };
}

const WORKOS_CFG = {
  auth: { workosApiBase: "https://api.workos.test", workosManagementApiKey: WORKOS_SECRET },
};

test("makeWorkosManagement.deleteUser: DELETE /user_management/users/<subject>, Bearer=WORKOS_MANAGEMENT_API_KEY", async () => {
  const { _fetch, seen } = captureFetch({ ok: true, status: 200 });
  const workos = makeWorkosManagement(WORKOS_CFG, { _fetch });
  const result = await workos.deleteUser("user_01ABC");
  assert.equal(seen.url, "https://api.workos.test/user_management/users/user_01ABC");
  assert.equal(seen.opts.method, "DELETE");
  assert.equal(seen.opts.headers.Authorization, `Bearer ${WORKOS_SECRET}`);
  assert.deepEqual(result, { deleted: true, alreadyGone: false });
});

test("makeWorkosManagement.deleteUser: 404 (bereits geloescht) zaehlt als Erfolg (Idempotenz/Konvergenz)", async () => {
  const { _fetch } = captureFetch({ ok: false, status: 404 });
  const workos = makeWorkosManagement(WORKOS_CFG, { _fetch });
  const result = await workos.deleteUser("user_gone");
  assert.deepEqual(result, { deleted: true, alreadyGone: true });
});

test("makeWorkosManagement.deleteUser: Fehlerstatus -> Meldung traegt NUR den HTTP-Status, kein Key-/Subject-Leak", async () => {
  const { _fetch } = captureFetch({ ok: false, status: 500 });
  const workos = makeWorkosManagement(WORKOS_CFG, { _fetch });
  await assert.rejects(
    () => workos.deleteUser("user_x_should_not_leak"),
    (err) => {
      assert.match(err.message, /HTTP 500/);
      assert.doesNotMatch(err.message, new RegExp(WORKOS_SECRET));
      assert.doesNotMatch(err.message, /user_x_should_not_leak/);
      return true;
    },
  );
});
