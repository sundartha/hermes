// P1 (C1 Stripe-Webhook-Race, S1-1, PLAN-FRAGILITY-REMEDIATION.md): applyStripeWebhookSerialized
// serialisiert Stripe-Webhook-Effekte pro Korrelationsschluessel (subscriptionId, Fallback
// tenantRef) und verwirft veraltete/doppelte Events (Ordnungswache). Testet GENAU die
// Invariante aus dem Phasenplan: das nach event.created SPAETERE Event gewinnt, unabhaengig
// davon, welcher der beiden Promise-Aufrufe zuerst FERTIG wird. Offline (F.I.R.S.T.), Muster
// wie p3-payment-webhook.test.js's fakeDeps.
//
// WICHTIG (P12 Independent): webhookLock/lastAppliedByKey in src/billing/webhook.js sind
// MODUL-SCOPE - sie leben ueber alle test()-Faelle DIESER Datei hinweg (node --test isoliert
// nur PRO DATEI, nicht pro test()). Jeder Testfall, der applyStripeWebhookSerialized ruft,
// MUSS daher einen EIGENEN, in dieser Datei einmaligen subscriptionId verwenden - sonst liest
// ein spaeterer Test den Dedup-/Ordnungs-Zustand eines frueheren Tests und wird faelschlich
// als "stale" verworfen oder faelschlich als "frisch" akzeptiert.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStripeWebhook,
  applyStripeWebhookSerialized,
  SUBSCRIPTION_EVENT,
} from "../src/billing/webhook.js";

const TENANT = "t_race";
const SLOW_EFFECT_DELAY_MS = 20; // haelt den langsameren Zweig sichtbar hinter dem schnellen
const EARLIER_CREATED = 1_700_000_000; // T
const LATER_CREATED = EARLIER_CREATED + 10; // T+10 (Stripe event.created, Sekunden)

// Fake-Seams wie p3-payment-webhook.test.js's fakeDeps, erweitert um eine pro-Status
// konfigurierbare Verzoegerung (simuliert den langsameren Zweig) und einen optionalen,
// geteilten executionOrder-Rekorder (fuer den Kreuz-Tenant-Sanity-Check).
function fakeDeps({ delays = {}, executionOrder = null, tenant = TENANT } = {}) {
  const calls = { setStatus: [], kyc: [], provision: [], suspend: [], audit: [] };
  return {
    calls,
    store: {
      findTenantBySubscription: () => null,
      setTenantSubscription: () => {},
      setKycLevel: (t, level) => calls.kyc.push([t, level]),
      tenantStripe: () => ({ customerId: null, paymentMethodId: null }),
      setTenantStripe: () => {},
      tenantSubscription: () => ({ planSlug: null }),
      setProfile: () => ({ profile: {}, changed: [] }),
      setSuspendedAtIfAbsent: (t) => calls.suspend.push(t),
      clearSuspendedAt: () => {},
      // GAP-04: ensureTenant (Spiegel-Nachzug NACH erfolgreicher Aktivierung). GAP-03:
      // clearBillingHold (Reversibilitaet bei ACTIVATE) - beide No-op-Fakes, dieser Test
      // prueft die Serialisierungs-/Ordnungswache-Invariante, nicht die Geld-Wirkung.
      ensureTenant: async () => {},
      clearBillingHold: () => {},
    },
    accounts: {
      setStatus: async (t, status) => {
        const delayMs = delays[status] || 0;
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (executionOrder) executionOrder.push(tenant);
        calls.setStatus.push([t, status]);
      },
      accountByTenant: async () => null,
    },
    sessions: { invalidateByTenant: async () => {} },
    audit: (name, _req, detail) => calls.audit.push([name, detail]),
    req: {},
    // GAP-04: activatePaidTenant aktiviert nur bei GEKLAERTEM Ergebnis (provisionCleared).
    provision: async (t) => {
      calls.provision.push(t);
      return { ok: true, reason: "queued" };
    },
  };
}

function activateEvent({ id, created, subId, tenant = TENANT }) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: { object: { id: subId, status: "active", metadata: { tenant_ref: tenant } } },
  };
}
function suspendEvent({ id, created, subId, tenant = TENANT }) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
    data: { object: { subscription: subId, metadata: { tenant_ref: tenant } } },
  };
}

// ---- (1) Race deterministisch aufgeloest -------------------------------------------

test("Race (Verzoegerung auf ACTIVATE): das spaetere SUSPEND gewinnt trotzdem", async () => {
  const subId = "sub_race_delay_activate";
  const deps = fakeDeps({ delays: { active: SLOW_EFFECT_DELAY_MS } });
  const p1 = applyStripeWebhookSerialized(activateEvent({ id: "evt_a1", created: EARLIER_CREATED, subId }), deps);
  const p2 = applyStripeWebhookSerialized(suspendEvent({ id: "evt_s1", created: LATER_CREATED, subId }), deps);
  await Promise.all([p1, p2]);
  assert.deepEqual(
    deps.calls.setStatus.at(-1),
    [TENANT, "suspended"],
    "das nach event.created spaetere Event gewinnt - nicht das zufaellig zuerst fertige",
  );
});

test("Race (Verzoegerung auf SUSPEND): das spaetere SUSPEND gewinnt weiterhin", async () => {
  const subId = "sub_race_delay_suspend";
  const deps = fakeDeps({ delays: { suspended: SLOW_EFFECT_DELAY_MS } });
  const p1 = applyStripeWebhookSerialized(activateEvent({ id: "evt_a2", created: EARLIER_CREATED, subId }), deps);
  const p2 = applyStripeWebhookSerialized(suspendEvent({ id: "evt_s2", created: LATER_CREATED, subId }), deps);
  await Promise.all([p1, p2]);
  assert.deepEqual(
    deps.calls.setStatus.at(-1),
    [TENANT, "suspended"],
    "identisches Endergebnis wie bei Verzoegerung auf ACTIVATE - die Ordnung haengt an " +
      "event.created, nicht am Promise-Timing",
  );
});

// Kontrolle (Muster prov01-drain-singleflight.test.js "Kontrolle"): OHNE Serialisierung -
// ruft die unveraenderte applyStripeWebhook direkt zweimal ueber Promise.all. Reproduziert
// den Bug, den P1 behebt: das LANGSAMERE (aber AELTERE) Event gewinnt faelschlich, weil es
// zufaellig zuletzt fertig wird. Beweist, dass die zwei Tests oben tatsaechlich etwas pruefen.
test("Kontrolle: OHNE Serialisierung gewinnt bei Verzoegerung auf ACTIVATE faelschlich das AELTERE Event", async () => {
  const subId = "sub_race_control_unserialized";
  const deps = fakeDeps({ delays: { active: SLOW_EFFECT_DELAY_MS } });
  const p1 = applyStripeWebhook(activateEvent({ id: "evt_ac", created: EARLIER_CREATED, subId }), deps);
  const p2 = applyStripeWebhook(suspendEvent({ id: "evt_sc", created: LATER_CREATED, subId }), deps);
  await Promise.all([p1, p2]);
  assert.deepEqual(
    deps.calls.setStatus.at(-1),
    [TENANT, "active"],
    "ungeguarded: das langsamere-aber-aeltere Event ueberschreibt das Suspend - genau der S1-1-Bug",
  );
});

// ---- (2) Event-ID-Dedup -------------------------------------------------------------

test("Event-ID-Dedup: exakt dasselbe Event zweimal -> zweiter Aufruf ist ein No-op", async () => {
  const subId = "sub_race_dedup";
  const deps = fakeDeps();
  const evt = activateEvent({ id: "evt_dup", created: EARLIER_CREATED, subId });
  await applyStripeWebhookSerialized(evt, deps);
  await applyStripeWebhookSerialized(evt, deps);
  assert.equal(deps.calls.kyc.length, 1, "KYC nur einmal gesetzt");
  assert.equal(deps.calls.setStatus.length, 1, "Status nur einmal gesetzt");
  assert.equal(deps.calls.provision.length, 1, "provision nur einmal aufgerufen");
});

// ---- (3) Ordnungswache ueber event.created (verschiedene event.id, G3/T5-Ergaenzung) ----

test("Ordnungswache: aelteres Event (anderes event.id) NACH einem bereits verarbeiteten neueren -> No-op", async () => {
  const subId = "sub_race_stale_order";
  const deps = fakeDeps();
  await applyStripeWebhookSerialized(suspendEvent({ id: "evt_new", created: LATER_CREATED, subId }), deps);
  await applyStripeWebhookSerialized(activateEvent({ id: "evt_old", created: EARLIER_CREATED, subId }), deps);
  assert.deepEqual(
    deps.calls.setStatus,
    [[TENANT, "suspended"]],
    "das aeltere ACTIVATE wird verworfen - kein Reaktivieren nach bereits verarbeitetem Suspend",
  );
  assert.deepEqual(deps.calls.kyc, [], "kein KYC=CARD durch das veraltete Event");
});

// ---- (3b) Gleichstand bei identischem event.created (AUDIT-1 Tie-Break) -------------
// Zwei VERSCHIEDENE echte Stripe-Events fuer denselben Korrelationsschluessel koennen
// dasselbe event.created tragen (z.B. ein customer.subscription.updated->active UND ein
// invoice.payment_failed in derselben Sekunde). Die Ordnungswache darf in diesem Fall NICHT
// die Ankunfts-/Lock-Reihenfolge entscheiden lassen, ob das gate-schliessende SUSPEND
// ueberlebt - sonst bleibt ein Tenant faelschlich active+CARD (Outbound-Gate faelschlich
// offen).

test("Gleichstand: ACTIVATE zuerst verarbeitet, dann SUSPEND (andere event.id, gleiches event.created) -> SUSPEND gewinnt", async () => {
  const subId = "sub_race_tie_activate_then_suspend";
  const deps = fakeDeps();
  await applyStripeWebhookSerialized(activateEvent({ id: "evt_tie_a1", created: EARLIER_CREATED, subId }), deps);
  await applyStripeWebhookSerialized(suspendEvent({ id: "evt_tie_s1", created: EARLIER_CREATED, subId }), deps);
  assert.deepEqual(
    deps.calls.setStatus.at(-1),
    [TENANT, "suspended"],
    "das SUSPEND darf bei gleichem event.created nicht als 'stale' gegenueber dem vorherigen ACTIVATE verworfen werden",
  );
  assert.deepEqual(deps.calls.suspend, [TENANT], "der Suspend-Grace-Anker beweist: SUSPEND wurde tatsaechlich angewendet, nicht verworfen");
});

test("Gleichstand: SUSPEND zuerst verarbeitet, dann ACTIVATE (andere event.id, gleiches event.created) -> Gate bleibt zu (fail-closed)", async () => {
  const subId = "sub_race_tie_suspend_then_activate";
  const deps = fakeDeps();
  await applyStripeWebhookSerialized(suspendEvent({ id: "evt_tie_s2", created: EARLIER_CREATED, subId }), deps);
  await applyStripeWebhookSerialized(activateEvent({ id: "evt_tie_a2", created: EARLIER_CREATED, subId }), deps);
  assert.deepEqual(
    deps.calls.setStatus,
    [[TENANT, "suspended"]],
    "das zeitgleiche ACTIVATE darf den bereits angewendeten SUSPEND nicht aufheben",
  );
  assert.deepEqual(deps.calls.kyc, [], "kein KYC=CARD durch das gate-oeffnende Tie-Event");
});

test("Gleichstand + gleiche event.id (Retry desselben SUSPEND-Events derselben Sekunde) bleibt ein No-op", async () => {
  const subId = "sub_race_tie_dedup_suspend";
  const deps = fakeDeps();
  const evt = suspendEvent({ id: "evt_tie_dup", created: EARLIER_CREATED, subId });
  await applyStripeWebhookSerialized(evt, deps);
  await applyStripeWebhookSerialized(evt, deps);
  assert.equal(deps.calls.setStatus.length, 1, "SUSPEND nur einmal angewendet - der Retry ist ein No-op");
  assert.equal(deps.calls.suspend.length, 1);
});

// ---- (3c) lastApplied.createdAt selbst NaN (Review-Blocker S1, symmetrischer Guard) ----
// Landet (z.B. durch ein Stripe-Event ohne event.created) ein Anker mit nicht auswertbarem
// createdAt in lastAppliedByKey, darf die Ordnungswache dadurch nicht vergiftet werden:
// `candidate.createdAt < NaN` und `> NaN` sind beide false, ohne den symmetrischen Guard
// faellt der Vergleich faelschlich in die Gleichstand-/Tie-Break-Logik und ein spaeteres,
// gueltiges ACTIVATE wuerde faelschlich als stale verworfen (der zahlende Tenant bliebe
// dauerhaft unreaktivierbar).

test("lastApplied.createdAt ist NaN (event.created fehlt): ein spaeteres gueltiges ACTIVATE wird trotzdem angewendet", async () => {
  const subId = "sub_race_poisoned_anchor";
  const deps = fakeDeps();
  // Erstes Event fuer den Schluessel traegt KEIN auswertbares event.created - lastApplied
  // ist beim ersten Aufruf null, isStaleEvent liefert dann unabhaengig vom createdAt immer
  // false, also wird angewendet und der (NaN-)Anker in lastAppliedByKey abgelegt.
  await applyStripeWebhookSerialized(suspendEvent({ id: "evt_poison", created: undefined, subId }), deps);
  assert.deepEqual(deps.calls.setStatus, [[TENANT, "suspended"]], "Vorbedingung: das erste Event wurde angewendet");
  // Zweites Event: normales ACTIVATE mit gueltigem, spaeterem event.created fuer denselben
  // Schluessel. OHNE den symmetrischen Guard ist der Vergleich mit dem NaN-Anker
  // unentscheidbar und faellt in den Tie-Break -> die Aktivierung bliebe faelschlich aus.
  await applyStripeWebhookSerialized(activateEvent({ id: "evt_reactivate", created: LATER_CREATED, subId }), deps);
  assert.deepEqual(
    deps.calls.setStatus.at(-1),
    [TENANT, "active"],
    "das ACTIVATE darf gegenueber einem unvergleichbaren (NaN) Anker nicht als stale verworfen werden",
  );
  assert.equal(deps.calls.kyc.length, 1, "KYC=CARD wurde tatsaechlich gesetzt - keine faelschlich verworfene Aktivierung");
});

// ---- (4) Verschiedene Korrelationsschluessel serialisieren NICHT gegeneinander ------

test("Verschiedene Korrelationsschluessel serialisieren NICHT gegeneinander (gekeyt statt global)", async () => {
  const executionOrder = [];
  const depsSlow = fakeDeps({ delays: { active: SLOW_EFFECT_DELAY_MS }, executionOrder, tenant: "t_cross_a" });
  const depsFast = fakeDeps({ executionOrder, tenant: "t_cross_b" });
  const pSlow = applyStripeWebhookSerialized(
    activateEvent({ id: "evt_cross_a", created: EARLIER_CREATED, subId: "sub_race_cross_a", tenant: "t_cross_a" }),
    depsSlow,
  );
  const pFast = applyStripeWebhookSerialized(
    activateEvent({ id: "evt_cross_b", created: EARLIER_CREATED, subId: "sub_race_cross_b", tenant: "t_cross_b" }),
    depsFast,
  );
  await Promise.all([pSlow, pFast]);
  assert.deepEqual(
    executionOrder,
    ["t_cross_b", "t_cross_a"],
    "der schnelle Effekt (anderer Schluessel) wird NICHT hinter dem langsamen Effekt eingereiht",
  );
  assert.deepEqual(depsSlow.calls.provision, ["t_cross_a"]);
  assert.deepEqual(depsFast.calls.provision, ["t_cross_b"]);
});

// ---- (5) Kein Korrelationsschluessel -> Passthrough ohne Lock -----------------------

test("Ohne subscriptionId/tenantRef: Passthrough zu applyStripeWebhook, dessen fail-closed no_tenant-Ignore greift", async () => {
  const deps = fakeDeps();
  await applyStripeWebhookSerialized(
    {
      id: "evt_no_key",
      created: EARLIER_CREATED,
      type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
      data: { object: { metadata: {} } },
    },
    deps,
  );
  assert.deepEqual(deps.calls.audit, [["stripe_webhook_ignored", "action=suspend no_tenant"]]);
  assert.deepEqual(deps.calls.setStatus, [], "kein Effekt ohne aufloesbaren Tenant");
});
