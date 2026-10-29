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

import {
  attachNumberPaymentIntent,
  attachNumberRegistration,
  markNumberElInboundTrunkBelegt,
  clearNumberElInboundTrunkBeleg,
  recordProvisioningJob,
  redriveAgeHoldReason,
  RELEASE_VERDICT,
  numberReleaseVerdict,
  setContractEndCleanupPending,
  contractEndCleanupPending,
  tenantsPendingContractEndCleanup,
  platformHoldEscalationCandidates,
  paidWithoutNumberCandidates,
  bindPlatformNumber,
  setSuspendedAtIfAbsent,
  setKycLevel,
  setTenantSubscription,
} from "../src/store/state-ops.js";
import { KYC_LEVEL, PROVIDER } from "../src/store/defaults.js";

const GRACE_MS = 60_000;
const MAX_AGE_MS = 120_000;
const SUSPENDED_ISO = "2026-01-01T00:00:00.000Z";
const SUSPENDED_MS = Date.parse(SUSPENDED_ISO);

const aktiveNummer = (s, tenantId, e164) => {
  registerTenant(s, tenantId);
  const { number } = requestNumber(s, { tenantId, ...CAPS });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164, providerNumberId: `tnx_${tenantId}` });
  return findNumber(s, number.id);
};

test("transitionNumber: unbekannte Nummer wirft 'nicht gefunden'", () => {
  const s = makeDefaultState();
  assert.throws(
    () => transitionNumber(s, "num_gibt_es_nicht", NUMBER_STATUS.ACTIVE),
    /nicht gefunden/,
  );
});

test("transitionNumber: Sperre durch Fremd-Bindung blockt suspended, nicht die Rueckkehr nach active", () => {
  const s = makeDefaultState();
  const number = aktiveNummer(s, "t_busy", "+4915755500101");
  bindPlatformNumber(s, {
    e164: number.e164,
    purpose: "fremdnutzung",
    provider: PROVIDER.TELNYX,
    tenantId: null,
  });
  assert.throws(
    () => transitionNumber(s, number.id, NUMBER_STATUS.SUSPENDED),
    /gesperrt .*abgelehnt/,
  );
  const frei = aktiveNummer(s, "t_frei", "+4915755500102");
  transitionNumber(s, frei.id, NUMBER_STATUS.SUSPENDED);
  bindPlatformNumber(s, {
    e164: frei.e164,
    purpose: "fremdnutzung",
    provider: PROVIDER.TELNYX,
    tenantId: null,
  });
  transitionNumber(s, frei.id, NUMBER_STATUS.ACTIVE);
  assert.equal(findNumber(s, frei.id).status, NUMBER_STATUS.ACTIVE);
});

test("attachNumberPaymentIntent und attachNumberRegistration: unbekannte Nummer wirft, Registrierung bleibt beim ersten Wert", () => {
  const s = makeDefaultState();
  assert.throws(() => attachNumberPaymentIntent(s, "num_x", "pi_1"), /nicht gefunden/);
  assert.throws(() => attachNumberRegistration(s, "num_x", "reg_1"), /nicht gefunden/);
  seedTenant(s);
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  assert.equal(attachNumberPaymentIntent(s, number.id, "pi_1").paymentIntentId, "pi_1");
  attachNumberRegistration(s, number.id, "reg_1");
  attachNumberRegistration(s, number.id, "reg_2");
  assert.equal(findNumber(s, number.id).providerAgentPhoneNumberId, "reg_1");
});

test("clearNumberElInboundTrunkBeleg: ein einzelnes gesetztes Belegfeld zaehlt, null-Felder nicht", () => {
  const s = makeDefaultState();
  const number = aktiveNummer(s, "t_beleg", "+4915755500103");
  number.elInboundTrunkBelegtAt = null;
  number.elInboundTrunkZugangFp = null;
  assert.equal(clearNumberElInboundTrunkBeleg(s, number.id).changed, false);
  number.elInboundTrunkZugangFp = "fp_eins";
  assert.equal(clearNumberElInboundTrunkBeleg(s, number.id).changed, true);
  assert.equal("elInboundTrunkZugangFp" in findNumber(s, number.id), false);
  assert.equal(clearNumberElInboundTrunkBeleg(s, number.id).changed, false);
  const belegt = { nowIso: SUSPENDED_ISO, zugangFp: "fp_zwei" };
  assert.equal(markNumberElInboundTrunkBelegt(s, number.id, belegt).changed, true);
});

test("activateNumber und recordProvisioningJob: Kennungen tragen Praefix asg_ und job_", () => {
  const s = makeDefaultState();
  aktiveNummer(s, "t_ids", "+4915755500104");
  assert.match(s.numberAssignments[0].id, /^asg_/);
  const job = recordProvisioningJob(s, { numberId: "n", tenantId: "t_ids", idempotencyKey: "k1" });
  assert.match(job.id, /^job_/);
  assert.equal(
    recordProvisioningJob(s, { numberId: "n", tenantId: "t_ids", idempotencyKey: "k1" }),
    job,
  );
});

test("releaseNumber: schliesst nur die offene Zuordnung der eigenen Nummer", () => {
  const s = makeDefaultState();
  const erste = aktiveNummer(s, "t_erste", "+4915755500105");
  const zweite = aktiveNummer(s, "t_zweite", "+4915755500106");
  releaseNumber(s, zweite.id);
  const zuErster = s.numberAssignments.find((a) => a.numberId === erste.id);
  const zuZweiter = s.numberAssignments.find((a) => a.numberId === zweite.id);
  assert.equal(zuErster.releasedAt, null);
  assert.ok(zuZweiter.releasedAt);
});

test("redriveAgeHoldReason: fehlender oder unlesbarer Zeitstempel, zu alt, Grenze", () => {
  const nowMs = SUSPENDED_MS;
  const vor = (alterMs) => ({ createdAt: new Date(nowMs - alterMs).toISOString() });
  assert.equal(redriveAgeHoldReason({}, nowMs, MAX_AGE_MS), "unknown_age");
  assert.equal(redriveAgeHoldReason({ createdAt: "kein-datum" }, nowMs, MAX_AGE_MS), "unknown_age");
  assert.equal(redriveAgeHoldReason(vor(MAX_AGE_MS + 1), nowMs, MAX_AGE_MS), "too_old");
  assert.equal(redriveAgeHoldReason(vor(MAX_AGE_MS), nowMs, MAX_AGE_MS), null);
});

test("numberReleaseVerdict: Werte skip/hold/release, Karenz-Grenze und eigene vs fremde Bindung", () => {
  assert.equal(RELEASE_VERDICT.HOLD, "hold");
  assert.equal(RELEASE_VERDICT.SKIP, "skip");
  assert.equal(RELEASE_VERDICT.RELEASE, "release");
  const s = makeDefaultState();
  const number = aktiveNummer(s, "t_verdict", "+4915755500107");
  setSuspendedAtIfAbsent(s, "t_verdict", SUSPENDED_ISO);
  assert.deepEqual(
    numberReleaseVerdict(s, number, { nowMs: SUSPENDED_MS + GRACE_MS, graceMs: GRACE_MS }),
    { action: "skip", reason: "grace_not_reached" },
  );
  const abgelaufen = { nowMs: SUSPENDED_MS + GRACE_MS + 1, graceMs: GRACE_MS };
  assert.deepEqual(numberReleaseVerdict(s, number, abgelaufen), {
    action: "release",
    reason: null,
  });
  bindPlatformNumber(s, {
    e164: number.e164,
    purpose: "eigene_nutzung",
    provider: PROVIDER.TELNYX,
    tenantId: "t_verdict",
  });
  assert.equal(numberReleaseVerdict(s, number, abgelaufen).action, "release");
  bindPlatformNumber(s, {
    e164: number.e164,
    purpose: "fremde_nutzung",
    provider: PROVIDER.TELNYX,
    tenantId: null,
  });
  assert.deepEqual(numberReleaseVerdict(s, number, abgelaufen), {
    action: "hold",
    reason: "platform_number_in_use",
  });
});

test("Vertragsende-Aufraeumen: setzen, nur genannte Felder aendern, Standard false", () => {
  const s = makeDefaultState();
  assert.equal(
    setContractEndCleanupPending(s, "t_unbekannt", { numberReleasePending: true }),
    null,
  );
  const keineFlags = { numberReleasePending: false, workosDeletePending: false };
  assert.deepEqual(contractEndCleanupPending(s, "t_unbekannt"), keineFlags);
  registerTenant(s, "t_cleanup");
  assert.deepEqual(contractEndCleanupPending(s, "t_cleanup"), keineFlags);
  assert.equal(setContractEndCleanupPending(s, "t_cleanup").id, "t_cleanup");
  setContractEndCleanupPending(s, "t_cleanup", { numberReleasePending: true });
  setContractEndCleanupPending(s, "t_cleanup", { workosDeletePending: true });
  assert.deepEqual(contractEndCleanupPending(s, "t_cleanup"), {
    numberReleasePending: true,
    workosDeletePending: true,
  });
  setContractEndCleanupPending(s, "t_cleanup", { numberReleasePending: false });
  assert.deepEqual(contractEndCleanupPending(s, "t_cleanup"), {
    numberReleasePending: false,
    workosDeletePending: true,
  });
});

test("tenantsPendingContractEndCleanup: genau die Mandanten mit mindestens einem offenen Flag", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_nummer");
  registerTenant(s, "t_workos");
  registerTenant(s, "t_nichts");
  setContractEndCleanupPending(s, "t_nummer", { numberReleasePending: true });
  setContractEndCleanupPending(s, "t_workos", { workosDeletePending: true });
  assert.deepEqual(
    tenantsPendingContractEndCleanup(s).map((tenant) => tenant.id),
    ["t_nummer", "t_workos"],
  );
});

test("platformHoldEscalationCandidates: nur Nummer-Freigabe, alt genug, Halt durch Plattform-Nutzung", () => {
  const s = makeDefaultState();
  const nowMs = SUSPENDED_MS + MAX_AGE_MS;
  const fremd = { provider: PROVIDER.TELNYX, tenantId: null };
  const festgehalten = aktiveNummer(s, "t_halt", "+4915755500108");
  setSuspendedAtIfAbsent(s, "t_halt", SUSPENDED_ISO);
  setContractEndCleanupPending(s, "t_halt", { numberReleasePending: true });
  bindPlatformNumber(s, { e164: festgehalten.e164, purpose: "p", ...fremd });

  const nurWorkos = aktiveNummer(s, "t_workos", "+4915755500109");
  setSuspendedAtIfAbsent(s, "t_workos", SUSPENDED_ISO);
  setContractEndCleanupPending(s, "t_workos", { workosDeletePending: true });
  bindPlatformNumber(s, { e164: nurWorkos.e164, purpose: "p", ...fremd });

  const imGespraech = aktiveNummer(s, "t_call", "+4915755500110");
  setSuspendedAtIfAbsent(s, "t_call", SUSPENDED_ISO);
  setContractEndCleanupPending(s, "t_call", { numberReleasePending: true });
  s.calls.push({ id: "call_x", status: "active", from: imGespraech.e164, to: "+4915700000000" });

  const ids = (grenze) =>
    platformHoldEscalationCandidates(s, { nowMs: grenze, maxAgeMs: MAX_AGE_MS }).map((n) => n.id);
  assert.deepEqual(ids(nowMs + 1), [festgehalten.id]);
  assert.deepEqual(ids(nowMs), []);
});

test("paidWithoutNumberCandidates: zahlender Abonnent ohne Live-Nummer nach Karenz, Grenze exakt", () => {
  const s = makeDefaultState();
  const paidSinceSec = SUSPENDED_MS / 1000;
  const bezahlt = (tenantId) => {
    registerTenant(s, tenantId);
    setKycLevel(s, tenantId, KYC_LEVEL.CARD);
    setTenantSubscription(s, tenantId, { currentPeriodStart: paidSinceSec });
  };
  bezahlt("t_ohne");
  bezahlt("t_mit");
  requestNumber(s, { tenantId: "t_mit", ...CAPS });
  registerTenant(s, "t_ohne_abo");
  setTenantSubscription(s, "t_ohne_abo", { currentPeriodStart: paidSinceSec });
  const kyc = { graceMs: GRACE_MS, kycMinLevel: KYC_LEVEL.CARD };
  assert.deepEqual(paidWithoutNumberCandidates(s, { nowMs: SUSPENDED_MS + GRACE_MS, ...kyc }), []);
  assert.deepEqual(paidWithoutNumberCandidates(s, { nowMs: SUSPENDED_MS + GRACE_MS + 1, ...kyc }), [
    { tenantId: "t_ohne", paidSinceIso: SUSPENDED_ISO },
  ]);
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
