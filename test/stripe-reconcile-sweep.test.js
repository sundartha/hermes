// Stripe-Abgleich-Sweep (billing/stripe-reconcile.js): heilt verlorene Stripe-Webhooks
// (Render-Free-Plan-Befund 2026-08-13: Events nach Ablauf aller Stripe-Retries endgueltig
// verloren). Reine In-Process-Units mit aufzeichnenden Fake-Seams, kein Netz, kein Spawn
// (F.I.R.S.T.) - Muster 312k-p4-contract-end-cleanup.test.js (fakeStore/fakeProvisioner/
// fakeAudit) + p3-payment-webhook.test.js (applyStripeWebhook-fakeDeps).
//
// WICHTIG (Ordnungswache): applyStripeWebhookSerialized haelt lastAppliedByKey ueber die
// gesamte Prozesslaufzeit (bewusst NIE geloescht, s. webhook.js). Jeder Test nutzt deshalb
// eine EIGENE subscriptionId (+ eigenen Tenant), damit kein Test den Anker eines anderen
// erbt - dieselbe Isolation, die stripe-webhook-race.test.js pro Fall verwendet.
import test from "node:test";
import assert from "node:assert/strict";
import {
  runStripeSubscriptionReconcile,
  syntheticSubscriptionDeletedEvent,
} from "../src/billing/stripe-reconcile.js";
import { tenantsForStripeReconcile } from "../src/store/state-ops.js";
import { SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";

const NOW_MS = 1765000000000;

// ---- geteilte Fakes (Muster 312k-p4-contract-end-cleanup.test.js) --------------------

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

// EINE mutable state-Referenz: ein Tenant mit gespeichertem Abo + aktiver Telnyx-Nummer.
// cancelAtPeriodEnd=true als Default (der Kuendigungsfall ist der Anlass des Sweeps);
// der Zahlungsausfall-Fall setzt es explizit auf false.
function seedState({ tenantId, subscriptionId, cancelAtPeriodEnd = true, suspendedAt = null }) {
  return {
    tenants: [
      {
        id: tenantId,
        stripeSubscriptionId: subscriptionId,
        stripeCancelAtPeriodEnd: cancelAtPeriodEnd,
        suspendedAt,
        idpSubject: null, // kein WorkOS-Fall in diesen Tests (deckt 312k-p4 ab)
      },
    ],
    numbers: [
      {
        id: `n_${tenantId}`,
        tenantId,
        status: NUMBER_STATUS.ACTIVE,
        provider: PROVIDER.TELNYX,
        providerNumberId: `ext_${tenantId}`,
      },
    ],
    numberAssignments: [
      { id: `a_${tenantId}`, numberId: `n_${tenantId}`, tenantId, assignedAt: "x", releasedAt: null },
    ],
  };
}

// Store-Fassade ueber der Kontraktflaeche, die der Sweep (load) + der DELETED-Zweig von
// applyStripeWebhook (tenantSubscription/setSuspendedAtIfAbsent) + attemptContractEnd-
// Cleanup (withStoreLock/save/tenantIdpSubject/setContractEndCleanupPending) brauchen.
function fakeStore(s) {
  const findTenant = (tenantId) => s.tenants.find((t) => t.id === tenantId);
  return {
    load: () => s,
    save: () => {},
    withStoreLock: (fn) => fn(),
    tenantSubscription: (tenantId) => ({
      subscriptionId: findTenant(tenantId)?.stripeSubscriptionId ?? null,
      cancelAtPeriodEnd: findTenant(tenantId)?.stripeCancelAtPeriodEnd ?? false,
    }),
    setSuspendedAtIfAbsent: (tenantId) => {
      const t = findTenant(tenantId);
      if (t && !t.suspendedAt) t.suspendedAt = new Date(NOW_MS).toISOString();
    },
    tenantIdpSubject: (tenantId) => findTenant(tenantId)?.idpSubject ?? null,
    setContractEndCleanupPending: (tenantId, patch) => {
      const t = findTenant(tenantId);
      if (t) Object.assign(t, patch);
      return t ?? null;
    },
    findTenantBySubscription: (subId) =>
      s.tenants.find((t) => t.stripeSubscriptionId === subId) ?? null,
  };
}

// Aufzeichnende Webhook-Deps um den fakeStore herum - dieselbe Kontraktflaeche, die
// wireWebLogin an den Sweep reicht (webhookDeps).
function makeDeps(s, { billingStatus, retrieveError } = {}) {
  const store = fakeStore(s);
  const calls = { setStatus: [], invalidate: [], retrieve: [] };
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  return {
    calls,
    prov,
    audit,
    store,
    sweepDeps: {
      store,
      billing: {
        retrieveSubscription: async (subId) => {
          calls.retrieve.push(subId);
          if (retrieveError) throw new Error(retrieveError);
          return { planSlug: null, numberSetupFeeExempt: false, status: billingStatus };
        },
      },
      webhookDeps: {
        store,
        accounts: { setStatus: async (tenant, status) => calls.setStatus.push([tenant, status]) },
        sessions: { invalidateByTenant: async (tenant) => calls.invalidate.push(tenant) },
        audit: () => {},
        req: null,
        provision: async () => ({ ok: true, reason: "queued" }),
        billing: {},
        numberProvisioner: prov,
        workos: null,
        auditStore: audit,
      },
      logger: fakeLogger(),
      nowMs: NOW_MS,
    },
  };
}

// ---- Selektor (reiner Kern) ----------------------------------------------------------

test("tenantsForStripeReconcile: nur Tenants mit Abo und ohne suspendedAt", () => {
  const s = {
    tenants: [
      { id: "t_mit_abo", stripeSubscriptionId: "sub_a", suspendedAt: null },
      { id: "t_suspendiert", stripeSubscriptionId: "sub_b", suspendedAt: "2026-08-01T00:00:00Z" },
      { id: "t_ohne_abo", stripeSubscriptionId: null, suspendedAt: null },
      { id: "t_leer" },
    ],
  };
  assert.deepEqual(
    tenantsForStripeReconcile(s).map((t) => t.id),
    ["t_mit_abo"],
    "suspendierte Tenants und Tenants ohne Abo bleiben draussen",
  );
});

// ---- Synthetisches Event (Vertrag mit webhook.js) ------------------------------------

test("syntheticSubscriptionDeletedEvent: DELETED-Typ, Sekunden-created, doppelter Anker (sub-id + tenant_ref)", () => {
  const event = syntheticSubscriptionDeletedEvent({
    tenantId: "t_x",
    subscriptionId: "sub_x",
    nowMs: NOW_MS,
  });
  assert.equal(event.type, SUBSCRIPTION_EVENT.DELETED);
  assert.equal(event.created, Math.floor(NOW_MS / 1000), "created in Stripe-Sekunden (Ordnungswache)");
  assert.equal(event.data.object.id, "sub_x");
  assert.equal(event.data.object.metadata.tenant_ref, "t_x");
  assert.ok(event.id.length > 0, "eindeutige Event-id (Dedup pro Lauf)");
});

// ---- Heilung: verlorenes DELETED nach Kuendigung -------------------------------------

test("Heilung Kuendigungsfall: Stripe=canceled + cancelAtPeriodEnd -> Suspend + Session-Kill + Telnyx-Release ueber den ECHTEN Webhook-Pfad", async () => {
  const s = seedState({ tenantId: "t_heal", subscriptionId: "sub_heal", cancelAtPeriodEnd: true });
  const { sweepDeps, calls, prov, s: _ } = { ...makeDeps(s, { billingStatus: "canceled" }), s };

  const result = await runStripeSubscriptionReconcile(sweepDeps);

  assert.deepEqual(result, { checked: 1, healed: 1, errors: 0 });
  assert.deepEqual(calls.setStatus, [["t_heal", "suspended"]], "Tenant gesperrt");
  assert.deepEqual(calls.invalidate, ["t_heal"], "Sessions invalidiert");
  assert.ok(s.tenants[0].suspendedAt, "Grace-Anker gestempelt");
  assert.equal(s.numbers[0].status, NUMBER_STATUS.RELEASED, "Telnyx-Nummer freigegeben (Kuendigung)");
  assert.deepEqual(prov.log, ["release:ext_t_heal"], "Provider-DELETE genau 1x");
});

test("Idempotenz: der geheilte Tenant faellt aus dem Selektor - zweiter Lauf ist ein No-Op", async () => {
  const s = seedState({ tenantId: "t_idem", subscriptionId: "sub_idem", cancelAtPeriodEnd: true });
  const deps = makeDeps(s, { billingStatus: "canceled" });

  await runStripeSubscriptionReconcile(deps.sweepDeps);
  const second = await runStripeSubscriptionReconcile(deps.sweepDeps);

  assert.deepEqual(second, { checked: 0, healed: 0, errors: 0 }, "suspendedAt schliesst den Tenant aus");
  assert.deepEqual(deps.calls.setStatus, [["t_idem", "suspended"]], "Suspend lief genau 1x");
  assert.deepEqual(deps.prov.log, ["release:ext_t_idem"], "kein zweiter Provider-DELETE");
});

// ---- Heilung: verlorenes DELETED nach Zahlungsausfall (byte-identische Webhook-Regel) --

test("Zahlungsausfall-Fall: Stripe=canceled OHNE cancelAtPeriodEnd -> Suspend, aber KEIN Release/Aufraeumen (dieselbe Regel wie der Webhook)", async () => {
  const s = seedState({ tenantId: "t_fail", subscriptionId: "sub_fail", cancelAtPeriodEnd: false });
  const deps = makeDeps(s, { billingStatus: "canceled" });

  const result = await runStripeSubscriptionReconcile(deps.sweepDeps);

  assert.deepEqual(result, { checked: 1, healed: 1, errors: 0 });
  assert.deepEqual(deps.calls.setStatus, [["t_fail", "suspended"]], "Tenant gesperrt");
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE, "Nummer bleibt (kein Kuendigungs-Aufraeumen)");
  assert.deepEqual(deps.prov.log, [], "kein Provider-DELETE");
});

// ---- Fail-closed: nichts heilen, was Stripe nicht eindeutig beendet meldet -----------

test("Fail-closed: status=active -> keine Mutation", async () => {
  const s = seedState({ tenantId: "t_act", subscriptionId: "sub_act" });
  const deps = makeDeps(s, { billingStatus: "active" });

  const result = await runStripeSubscriptionReconcile(deps.sweepDeps);

  assert.deepEqual(result, { checked: 1, healed: 0, errors: 0 });
  assert.deepEqual(deps.calls.setStatus, [], "kein Suspend");
  assert.equal(s.tenants[0].suspendedAt, null, "kein Grace-Anker");
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE, "Nummer unangetastet");
});

test("Fail-closed: status=null (Feld fehlt in der Stripe-Antwort) -> keine Mutation", async () => {
  const s = seedState({ tenantId: "t_null", subscriptionId: "sub_null" });
  const deps = makeDeps(s, { billingStatus: null });

  const result = await runStripeSubscriptionReconcile(deps.sweepDeps);

  assert.deepEqual(result, { checked: 1, healed: 0, errors: 0 });
  assert.deepEqual(deps.calls.setStatus, [], "kein Suspend ohne beurteilbaren Status");
});

test("Fail-closed: Stripe-API-Fehler -> keine Mutation, als error gezaehlt, Sweep laeuft weiter", async () => {
  const s = seedState({ tenantId: "t_err", subscriptionId: "sub_err" });
  const deps = makeDeps(s, { retrieveError: "retrieveSubscription fehlgeschlagen (502)" });

  const result = await runStripeSubscriptionReconcile(deps.sweepDeps);

  assert.deepEqual(result, { checked: 1, healed: 0, errors: 1 });
  assert.deepEqual(deps.calls.setStatus, [], "kein Suspend bei unerreichbarem Stripe");
  assert.equal(s.tenants[0].suspendedAt, null, "kein Grace-Anker");
  assert.ok(
    deps.sweepDeps.logger.lines.some((l) => l.includes("t_err")),
    "Fehler geloggt (PII-frei, nur Tenant-id)",
  );
});
