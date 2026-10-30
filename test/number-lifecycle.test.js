import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  markTenantNeedsManualReconcile,
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
} from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  TENANT_STATUS,
  BOOTSTRAP_TENANT_ID,
  GLOBAL_CAP_REASON,
  shouldPersistProvisionResult,
} from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const seedTenant = (s, id = "t_user1") => registerTenant(s, id);

test("canTransitionNumber: legale Kette erlaubt, Spruenge verboten", () => {
  assert.equal(canTransitionNumber(NUMBER_STATUS.REQUESTED, NUMBER_STATUS.PROVISIONING), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.PROVISIONING, NUMBER_STATUS.ACTIVE), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.ACTIVE, NUMBER_STATUS.SUSPENDED), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.REQUESTED, NUMBER_STATUS.ACTIVE), false);
  assert.equal(canTransitionNumber(NUMBER_STATUS.RELEASED, NUMBER_STATUS.ACTIVE), false);
  assert.equal(canTransitionNumber("garbage", NUMBER_STATUS.ACTIVE), false);
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
  const named = registerTenant(s, "t_named", { firstName: "Maria", lastName: "Mueller" });
  assert.equal(named.firstName, "Maria");
  assert.equal(named.ownerName, "Maria Mueller");
  assert.ok(!("ownerName" in registerTenant(s, "t_plain")));
  assert.ok(!("firstName" in registerTenant(s, "t_plain")));
  assert.ok(!("ownerName" in registerTenant(s, "t_ws", { firstName: "   ", lastName: "  " })));
  assert.equal(registerTenant(s, "t_named", { firstName: "Bob" }).ownerName, "Maria Mueller");
});

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

test("liveNumbers/requestNumber: RELEASED/FAILED belegen keine Kapazitaet - Cap greift erst bei echter Auslastung", () => {
  const s = makeDefaultState();
  registerTenant(s, "dead1");
  registerTenant(s, "dead2");
  registerTenant(s, "live1");
  const caps = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  const dead1 = requestNumber(s, { tenantId: "dead1", ...caps }).number;
  failNumber(s, dead1.id);
  const dead2 = requestNumber(s, { tenantId: "dead2", ...caps }).number;
  beginProvisioning(s, dead2.id);
  activateNumber(s, dead2.id, { e164: "+4915799990002", providerNumberId: "num_dead2" });
  releaseNumber(s, dead2.id);
  const live = requestNumber(s, { tenantId: "live1", ...caps });
  assert.equal(live.ok, true, "Cap greift NICHT vorzeitig durch terminale Nummern");
});

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
  const loose = { maxNumbers: 5, maxNumbersPerTenant: 1 };
  const retry = requestNumber(s, { tenantId: "b", ...loose });
  assert.equal(retry.ok, true);
  const tenantB = findTenant(s, "b");
  assert.equal(tenantB.numberProvisionSkipReason, null);
  assert.equal(tenantB.numberProvisionSkipAt, null);
});

test("shouldPersistProvisionResult: Erfolg UND global_cap persistieren, jeder andere Skip nicht", () => {
  assert.equal(shouldPersistProvisionResult({ ok: true }), true);
  assert.equal(shouldPersistProvisionResult({ ok: false, reason: GLOBAL_CAP_REASON }), true);
  assert.equal(shouldPersistProvisionResult({ ok: false, reason: "tenant_cap" }), false);
  assert.equal(shouldPersistProvisionResult({ ok: false, reason: "tenant_inactive" }), false);
});

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
  assert.equal(requestNumber(s, { tenantId: "t_user1", ...CAPS }).ok, true);
});

const ERLAUBTE_UEBERGAENGE = {
  requested: ["provisioning", "failed"],
  provisioning: ["capturing", "active", "failed"],
  capturing: ["active", "failed"],
  active: ["suspended", "released"],
  suspended: ["active", "released"],
  failed: ["released"],
  released: [],
};
const ALLE_STATUS = Object.keys(ERLAUBTE_UEBERGAENGE);

const nummerAufWeg = (s, weg) => {
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  for (const status of weg) {
    if (status === "active" && findNumber(s, number.id).status === "provisioning") {
      activateNumber(s, number.id, { e164: "+4915755500001", providerNumberId: "tnx_nie" });
    } else {
      transitionNumber(s, number.id, status);
    }
  }
  return number.id;
};

test("[NIE1] Uebergangstabelle erlaubt genau die vorgesehenen Zielstatus, aus released keinen", async () => {
  const { NUMBER_TRANSITIONS } = await import("../src/store/defaults.js");
  assert.deepEqual(
    Object.fromEntries(Object.entries(NUMBER_TRANSITIONS).map(([von, nach]) => [von, [...nach]])),
    ERLAUBTE_UEBERGAENGE,
  );
  for (const von of ALLE_STATUS) {
    for (const nach of ALLE_STATUS) {
      assert.equal(
        canTransitionNumber(von, nach),
        ERLAUBTE_UEBERGAENGE[von].includes(nach),
        `${von} -> ${nach}`,
      );
    }
  }
});

test("[NIE2] Nummernstatus traegt beim Anfordern bis Freigeben die vorgesehenen Werte", () => {
  const s = makeDefaultState();
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  assert.equal(findNumber(s, number.id).status, "requested");
  beginProvisioning(s, number.id);
  assert.equal(findNumber(s, number.id).status, "provisioning");
  beginCapturing(s, number.id);
  assert.equal(findNumber(s, number.id).status, "capturing");
  activateNumber(s, number.id, { e164: "+4915755500002", providerNumberId: "tnx_nie2" });
  assert.equal(findNumber(s, number.id).status, "active");
  transitionNumber(s, number.id, NUMBER_STATUS.SUSPENDED);
  assert.equal(findNumber(s, number.id).status, "suspended");
  releaseNumber(s, number.id);
  assert.equal(findNumber(s, number.id).status, "released");
  assert.deepEqual(
    { ...NUMBER_STATUS },
    {
      REQUESTED: "requested",
      PROVISIONING: "provisioning",
      CAPTURING: "capturing",
      ACTIVE: "active",
      FAILED: "failed",
      SUSPENDED: "suspended",
      RELEASED: "released",
    },
  );
});

test("[NIE3] Status eines Bereitstellungsjobs sind queued, done und failed", async () => {
  const { PROVISIONING_JOB_STATUS } = await import("../src/store/defaults.js");
  assert.deepEqual(
    { ...PROVISIONING_JOB_STATUS },
    { QUEUED: "queued", DONE: "done", FAILED: "failed" },
  );
  assert.ok(Object.isFrozen(PROVISIONING_JOB_STATUS));
});

test("[NIE4] Uebergang in unbekannten Status wird aus keinem Status angenommen", () => {
  const unbekannterStatus = "unbekannt";
  for (const von of [...ALLE_STATUS, "garbage"]) {
    assert.equal(canTransitionNumber(von, unbekannterStatus), false, `${von} -> unbekannt`);
  }
  const wege = {
    requested: [],
    provisioning: ["provisioning"],
    capturing: ["provisioning", "capturing"],
    active: ["provisioning", "active"],
    suspended: ["provisioning", "active", "suspended"],
    failed: ["failed"],
    released: ["provisioning", "active", "released"],
  };
  for (const [status, weg] of Object.entries(wege)) {
    const s = makeDefaultState();
    const id = nummerAufWeg(s, weg);
    assert.equal(findNumber(s, id).status, status);
    assert.throws(() => transitionNumber(s, id, unbekannterStatus), /illegaler Uebergang/);
    assert.equal(findNumber(s, id).status, status, "Status unveraendert");
  }
});

test("requestNumber vergibt eine Kennung mit Praefix num_", () => {
  const state = makeDefaultState();
  seedTenant(state);
  const result = requestNumber(state, { tenantId: "t_user1", ...CAPS });
  assert.equal(result.ok, true);
  assert.ok(result.number.id.startsWith("num_"));
});

test("markTenantNeedsManualReconcile gibt den Mandanten zurueck und aendert ihn nur beim ersten Aufruf", () => {
  const state = makeDefaultState();
  seedTenant(state);
  assert.deepEqual(markTenantNeedsManualReconcile(state, "t_gibt_es_nicht"), { tenant: null, changed: false });
  const first = markTenantNeedsManualReconcile(state, "t_user1");
  assert.equal(first.changed, true);
  assert.equal(first.tenant, findTenant(state, "t_user1"));
  const second = markTenantNeedsManualReconcile(state, "t_user1");
  assert.equal(second.changed, false);
  assert.equal(second.tenant, findTenant(state, "t_user1"));
});
