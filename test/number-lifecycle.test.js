// Onboarding-State-Machine (zahlungsfrei). Prueft die fail-closed-Invarianten:
// eine Nummer wird NIE direkt 'active' (nur ueber requested->provisioning->active),
// illegale Uebergaenge werfen, und die Cap-Notbremse (maxNumbers/maxNumbersPerTenant)
// ersetzt das uebersprungene Stripe-Schloss. Rein (state-ops + defaults), offline,
// kein pglite/Server (getrennte Dateien -> kein Test-Worker-Stall).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  beginProvisioning,
  beginCapturing,
  activateNumber,
  failNumber,
  releaseNumber,
  transitionNumber,
  canTransitionNumber,
  findNumber,
  findTenant,
  findTenantByNumber,
  markTenantNumbersCancelled,
  reactivateTenantCancelledNumbers,
  tenantHasLiveNumber,
} from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  TENANT_STATUS,
  BOOTSTRAP_TENANT_ID,
  GLOBAL_CAP_REASON,
  SUBSCRIPTION_CANCELLED_REASON,
  shouldPersistProvisionResult,
} from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const seedTenant = (s, id = "t_user1") => registerTenant(s, id);

// ---- Transitions-Matrix (fail-closed) ----
test("canTransitionNumber: legale Kette erlaubt, Spruenge verboten", () => {
  assert.equal(canTransitionNumber(NUMBER_STATUS.REQUESTED, NUMBER_STATUS.PROVISIONING), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.PROVISIONING, NUMBER_STATUS.ACTIVE), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.ACTIVE, NUMBER_STATUS.SUSPENDED), true);
  // Spruenge + terminal:
  assert.equal(canTransitionNumber(NUMBER_STATUS.REQUESTED, NUMBER_STATUS.ACTIVE), false);
  assert.equal(canTransitionNumber(NUMBER_STATUS.RELEASED, NUMBER_STATUS.ACTIVE), false);
  assert.equal(canTransitionNumber("garbage", NUMBER_STATUS.ACTIVE), false);
  // P6b1: capturing-Edges (additiv; provisioning->active bleibt fuer payment-off legal)
  assert.equal(canTransitionNumber(NUMBER_STATUS.PROVISIONING, NUMBER_STATUS.CAPTURING), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.CAPTURING, NUMBER_STATUS.ACTIVE), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.CAPTURING, NUMBER_STATUS.FAILED), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.CAPTURING, NUMBER_STATUS.SUSPENDED), false);
  assert.equal(canTransitionNumber(NUMBER_STATUS.CAPTURING, NUMBER_STATUS.RELEASED), false);
});

test("beginCapturing: provisioning -> capturing legal, aus requested illegal (fail-closed)", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  // aus requested ist capturing kein legaler Sprung
  assert.throws(() => beginCapturing(s, number.id), /illegaler Uebergang/);
  beginProvisioning(s, number.id);
  beginCapturing(s, number.id);
  assert.equal(findNumber(s, number.id).status, NUMBER_STATUS.CAPTURING);
});

test("transitionNumber: illegaler Uebergang wirft (kein active per Shortcut)", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  assert.throws(() => transitionNumber(s, number.id, NUMBER_STATUS.ACTIVE), /illegaler Uebergang/);
  assert.equal(
    findNumber(s, number.id).status,
    NUMBER_STATUS.REQUESTED,
    "Status unveraendert nach Reject",
  );
});

// ---- registerTenant ----
test("registerTenant: idempotent, Owner existiert immer", () => {
  const s = makeDefaultState();
  assert.equal(s.tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID).status, TENANT_STATUS.ACTIVE);
  const a = registerTenant(s, "t_x");
  const b = registerTenant(s, "t_x");
  assert.equal(a, b);
  assert.equal(s.tenants.filter((t) => t.id === "t_x").length, 1);
});

test("registerTenant: Identitaet set-on-create (G1: firstName/lastName komponieren ownerName, leer weg, Re-Register unveraendert)", () => {
  const s = makeDefaultState();
  // firstName + lastName -> firstName gesetzt + ownerName komponiert
  const named = registerTenant(s, "t_named", { firstName: "Maria", lastName: "Mueller" });
  assert.equal(named.firstName, "Maria");
  assert.equal(named.ownerName, "Maria Mueller");
  // 2-arg -> kein Feld (byte-identisch zum Bestand -> Owner-Fallback)
  assert.ok(!("ownerName" in registerTenant(s, "t_plain")));
  assert.ok(!("firstName" in registerTenant(s, "t_plain")));
  // whitespace-only -> Felder weggelassen (kein Daten-Muell)
  assert.ok(!("ownerName" in registerTenant(s, "t_ws", { firstName: "   ", lastName: "  " })));
  // set-on-create: Re-Register mit anderem Namen aendert NICHTS (kein Upsert)
  assert.equal(registerTenant(s, "t_named", { firstName: "Bob" }).ownerName, "Maria Mueller");
});

// ---- requestNumber + Caps (Kosten-Notbremse) ----
test("requestNumber: happy path -> status requested, KEINE e164/Kauf", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const res = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  assert.equal(res.ok, true);
  assert.equal(res.number.status, NUMBER_STATUS.REQUESTED);
  assert.equal(res.number.e164, null, "requested Nummer hat noch keine e164");
});

test("requestNumber: globaler Cap blockt (Kosten-Notbremse)", () => {
  const s = makeDefaultState();
  // Cap 2 global, viele Tenants -> ab der 3. Nummer blockiert.
  registerTenant(s, "a");
  registerTenant(s, "b");
  registerTenant(s, "c");
  const caps = { maxNumbers: 2, maxNumbersPerTenant: 1 };
  assert.equal(requestNumber(s, { tenantId: "a", ...caps }).ok, true);
  assert.equal(requestNumber(s, { tenantId: "b", ...caps }).ok, true);
  const blocked = requestNumber(s, { tenantId: "c", ...caps });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "global_cap");
});

test("requestNumber: per-Tenant-Cap blockt", () => {
  const s = makeDefaultState();
  seedTenant(s);
  assert.equal(requestNumber(s, { tenantId: "t_user1", ...CAPS }).ok, true);
  const second = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "tenant_cap");
});

test("requestNumber: unbekannter/inaktiver Tenant blockt (fail-closed)", () => {
  const s = makeDefaultState();
  assert.equal(requestNumber(s, { tenantId: "nope", ...CAPS }).reason, "tenant_inactive");
  const t = registerTenant(s, "susp");
  t.status = TENANT_STATUS.SUSPENDED;
  assert.equal(requestNumber(s, { tenantId: "susp", ...CAPS }).reason, "tenant_inactive");
});

// ---- Phase A: Cap-Zaehlung robust (Regressions-Lock, kein neues Verhalten) ----
test("liveNumbers/requestNumber: RELEASED/FAILED belegen keine Kapazitaet - Cap greift erst bei echter Auslastung", () => {
  const s = makeDefaultState();
  registerTenant(s, "dead1");
  registerTenant(s, "dead2");
  registerTenant(s, "live1");
  const caps = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  const dead1 = requestNumber(s, { tenantId: "dead1", ...caps }).number;
  failNumber(s, dead1.id); // requested -> failed (terminal)
  const dead2 = requestNumber(s, { tenantId: "dead2", ...caps }).number; // Slot war durch failed wieder frei
  beginProvisioning(s, dead2.id);
  activateNumber(s, dead2.id, { e164: "+4915799990002", providerNumberId: "num_dead2" });
  releaseNumber(s, dead2.id); // terminal
  const live = requestNumber(s, { tenantId: "live1", ...caps });
  assert.equal(live.ok, true, "Cap greift NICHT vorzeitig durch terminale Nummern");
});

// ---- Phase A: Skip sichtbar machen (Fix B) ----
test("requestNumber: global_cap hinterlaesst Skip-Marker am Tenant (reine Observability)", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const caps = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  requestNumber(s, { tenantId: "a", ...caps });
  const blocked = requestNumber(s, { tenantId: "b", ...caps });
  assert.equal(blocked.reason, GLOBAL_CAP_REASON);
  const tenantB = findTenant(s, "b");
  assert.equal(tenantB.numberProvisionSkipReason, GLOBAL_CAP_REASON);
  assert.ok(tenantB.numberProvisionSkipAt, "Zeitstempel gesetzt");
});

test("requestNumber: Skip-Marker verschwindet bei erfolgreichem Folge-Request (Invariante 3)", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const tight = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  requestNumber(s, { tenantId: "a", ...tight });
  const blocked = requestNumber(s, { tenantId: "b", ...tight });
  assert.equal(blocked.reason, GLOBAL_CAP_REASON);
  assert.equal(findTenant(s, "b").numberProvisionSkipReason, GLOBAL_CAP_REASON);
  // Cap oeffnet sich -> erfolgreicher Folge-Request loescht den Marker wieder (kein
  // dauerhaft haengender "blocked"-Chip nach erfolgreichem Retry).
  const loose = { maxNumbers: 5, maxNumbersPerTenant: 1 };
  const retry = requestNumber(s, { tenantId: "b", ...loose });
  assert.equal(retry.ok, true);
  const tenantB = findTenant(s, "b");
  assert.equal(tenantB.numberProvisionSkipReason, null);
  assert.equal(tenantB.numberProvisionSkipAt, null);
});

// ---- Review-Fix (Runde 1): shouldPersistProvisionResult (G5, geteilt von POST
// /api/onboard UND triggerTenantProvisioning, vorher woertlich dupliziert) ----
test("shouldPersistProvisionResult: Erfolg UND global_cap persistieren, jeder andere Skip nicht", () => {
  assert.equal(shouldPersistProvisionResult({ ok: true }), true);
  assert.equal(shouldPersistProvisionResult({ ok: false, reason: GLOBAL_CAP_REASON }), true);
  assert.equal(shouldPersistProvisionResult({ ok: false, reason: "tenant_cap" }), false);
  assert.equal(shouldPersistProvisionResult({ ok: false, reason: "tenant_inactive" }), false);
});

// ---- Fix P1: Stripe-Cancel-Nummer-Leak (PLAN-STRIPE-CANCEL-NUMBER-LEAK.md) ----
test("markTenantNumbersCancelled: ACTIVE -> SUSPENDED+Marker, faellt aus dem globalen Cap, tenantHasLiveNumber bleibt true (Invariante 4)", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const caps = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  const { number } = requestNumber(s, { tenantId: "a", ...caps });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164: "+4915711110001", providerNumberId: "num_a" });
  // Baseline (Ausgangs-Leak): Cap=1 voll -> Tenant B kann noch nicht provisionieren.
  assert.equal(requestNumber(s, { tenantId: "b", ...caps }).ok, false, "Cap voll vor Kuendigung");

  const cancelled = markTenantNumbersCancelled(s, "a");

  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].id, number.id);
  const stored = findNumber(s, number.id);
  assert.equal(stored.status, NUMBER_STATUS.SUSPENDED);
  assert.equal(stored.suspendReason, SUBSCRIPTION_CANCELLED_REASON);
  // Invariante 4: die PER-TENANT-Sicht sieht die Nummer WEITER (Provisioning-Trigger fragt
  // bei Re-Subscribe keine zweite an).
  assert.equal(tenantHasLiveNumber(s, "a"), true);
  // Smoke aus der Spec: Tenant A kuendigt -> Tenant B kann jetzt provisionieren (der Fix).
  assert.equal(
    requestNumber(s, { tenantId: "b", ...caps }).ok,
    true,
    "Cap-Slot durch Kuendigung frei",
  );
});

test("markTenantNumbersCancelled: Regression - Abuse/Budget-SUSPENDED (kein eigener Marker) bleibt unangetastet und zaehlt weiter gegen den globalen Cap", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const caps = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  const { number } = requestNumber(s, { tenantId: "a", ...caps });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164: "+4915711110002", providerNumberId: "num_b" });
  transitionNumber(s, number.id, NUMBER_STATUS.SUSPENDED); // Abuse/Budget-Sperre, KEIN Marker

  const cancelled = markTenantNumbersCancelled(s, "a");

  assert.equal(cancelled.length, 0, "bereits SUSPENDED ist kein ACTIVE-Kandidat");
  assert.equal(findNumber(s, number.id).suspendReason, undefined, "kein Marker gesetzt");
  assert.equal(
    requestNumber(s, { tenantId: "b", ...caps }).reason,
    GLOBAL_CAP_REASON,
    "zaehlt weiter gegen den Cap",
  );
});

test("reactivateTenantCancelledNumbers: SUSPENDED+Marker -> ACTIVE, Marker geloescht, findTenantByNumber routet wieder", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164: "+4915711110003", providerNumberId: "num_c" });
  markTenantNumbersCancelled(s, "t_user1");
  assert.equal(findTenantByNumber(s, "+4915711110003"), null, "gekuendigt -> nicht mehr routbar");

  const reactivated = reactivateTenantCancelledNumbers(s, "t_user1");

  assert.equal(reactivated.length, 1);
  const stored = findNumber(s, number.id);
  assert.equal(stored.status, NUMBER_STATUS.ACTIVE);
  assert.equal(stored.suspendReason, null);
  assert.equal(findTenantByNumber(s, "+4915711110003"), "t_user1", "routet wieder");
});

test("reactivateTenantCancelledNumbers: Safety - reaktiviert NIE eine Abuse/Budget-SUSPENDED-Nummer ohne eigenen Marker", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164: "+4915711110004", providerNumberId: "num_d" });
  transitionNumber(s, number.id, NUMBER_STATUS.SUSPENDED); // Ops-Sperre, KEIN Marker

  const reactivated = reactivateTenantCancelledNumbers(s, "t_user1");

  assert.equal(reactivated.length, 0, "ein Billing-Event darf eine Ops-Sperre NIE aufheben");
  assert.equal(findNumber(s, number.id).status, NUMBER_STATUS.SUSPENDED, "bleibt gesperrt");
});

test("markTenantNumbersCancelled/reactivateTenantCancelledNumbers: Grenzfall - Tenant ohne passende Nummer -> No-Op, kein Wurf", () => {
  const s = makeDefaultState();
  seedTenant(s);
  assert.deepEqual(markTenantNumbersCancelled(s, "t_user1"), []);
  assert.deepEqual(reactivateTenantCancelledNumbers(s, "t_user1"), []);
  assert.deepEqual(markTenantNumbersCancelled(s, "unbekannt"), []);
  assert.deepEqual(reactivateTenantCancelledNumbers(s, "unbekannt"), []);
});

// ---- Voller Lebenszyklus ----
test("happy path: request -> provisioning -> active setzt e164 + legt assignment an", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  beginProvisioning(s, number.id);
  assert.equal(findNumber(s, number.id).status, NUMBER_STATUS.PROVISIONING);
  activateNumber(s, number.id, { e164: "+4915799999999", providerNumberId: "tnx_123" });
  const active = findNumber(s, number.id);
  assert.equal(active.status, NUMBER_STATUS.ACTIVE);
  assert.equal(active.e164, "+4915799999999");
  assert.equal(active.providerNumberId, "tnx_123");
  const asg = s.numberAssignments.find((a) => a.numberId === number.id);
  assert.ok(asg && !asg.releasedAt, "offene assignment-Zeile bei Aktivierung");
});

test("Fehlerpfad: provisioning -> failed (kein active, keine assignment)", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  beginProvisioning(s, number.id);
  failNumber(s, number.id);
  assert.equal(findNumber(s, number.id).status, NUMBER_STATUS.FAILED);
  assert.equal(s.numberAssignments.length, 0, "keine assignment bei Fehlschlag");
});

// ---- Inbound-Routing-Gate: NUR status=active routet (fail-closed) ----
test("findTenantByNumber: nur active routet; requested/suspended/released -> null", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164: "+4915700000009", providerNumberId: "x" });
  assert.equal(findTenantByNumber(s, "+4915700000009"), "t_user1", "active -> routet");
  transitionNumber(s, number.id, NUMBER_STATUS.SUSPENDED);
  assert.equal(findTenantByNumber(s, "+4915700000009"), null, "suspended -> nicht routbar");
  transitionNumber(s, number.id, NUMBER_STATUS.RELEASED);
  assert.equal(findTenantByNumber(s, "+4915700000009"), null, "released -> nicht routbar");
});

test("release schliesst die assignment (released_at) und gibt den Platz frei", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164: "+4915788888888", providerNumberId: "tnx_9" });
  releaseNumber(s, number.id);
  assert.equal(findNumber(s, number.id).status, NUMBER_STATUS.RELEASED);
  assert.ok(
    s.numberAssignments.find((a) => a.numberId === number.id).releasedAt,
    "assignment geschlossen",
  );
  // Platz wieder frei -> neue Anfrage erlaubt (per-Tenant-Cap 1).
  assert.equal(requestNumber(s, { tenantId: "t_user1", ...CAPS }).ok, true);
});
