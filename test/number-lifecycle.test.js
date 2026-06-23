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
  findTenantByNumber,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS, TENANT_STATUS, OWNER_TENANT_ID } from "../src/store/defaults.js";

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
  assert.equal(s.tenants.find((t) => t.id === OWNER_TENANT_ID).status, TENANT_STATUS.ACTIVE);
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
