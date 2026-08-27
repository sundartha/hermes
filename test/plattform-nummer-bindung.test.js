// OUTBOUND-E1: Plattform-Nummern-Bindung (platform_number_use) + dreifacher
// Freigabe-Riegel, Ebene A (transitionNumber/releaseNumber) + Ebene B (Verdikt/Koerbe) +
// Boot-Ableitung + Boot-Guard-Befund. Reine In-Process-Units (state-ops/release-reconcile/
// boot/boot-guard), kein Spawn, kein pglite, kein Netz (F.I.R.S.T.).
//
// PII (Regel 9): NUR erkennbar fiktive Nummern aus dem Bestandsstil.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  platformNumberBinding,
  numberBusyReason,
  bindPlatformNumber,
  syncPlatformBindings,
  transitionNumber,
  releaseNumber,
  numberReleaseVerdict,
  tenantNumbersForErase,
  RELEASE_VERDICT,
  findNumber,
  eraseTenantData,
} from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  PLATFORM_NUMBER_PURPOSE,
  NUMBER_HOLD_REASON,
  PROVIDER,
  TENANT_STATUS,
  BOOTSTRAP_TENANT_ID,
} from "../src/store/defaults.js";
import { releaseTenantNumbersOnErase } from "../src/release-reconcile.js";
import { attemptContractEndCleanup } from "../src/billing/contract-end-cleanup.js";
import { platformAniFindings } from "../src/boot-guard.js";
import { derivePlatformNumberBindings } from "../src/boot.js";
import { fakeProvisioner } from "./helpers.js";

// Erkennbar fiktive Nummern (Regel 9). ANI/Alarm-Absender/Kunden-DID sind bewusst
// UNTERSCHIEDLICH, damit ein Test nie zwei Rollen ueber dieselbe Zeichenkette verwechselt.
const ANI = "+15005550006";
const ALERT_SENDER = "+15005550007";
const CUSTOMER_DID = "+4915112345678";

// Bare-Literal-Konstanten (no-magic-numbers/enforceConst: NUR ein einzelner Literal direkt
// an einem const ist ausgenommen - ein Ausdruck wie "24 * 60 * 60 * 1000" zaehlt trotz
// const-Deklaration als Magic Number, weil jeder Operand ein eigener Literal-Knoten ist).
const THIRTY_DAYS_MS = 2592000000; // Alter des simulierten Suspends (> Grace)
const FOURTEEN_DAYS_MS = 1209600000; // Grace-Frist des Verdikts
const TWO_DERIVED_BINDINGS = 2; // Boot leitet outbound_ani + alert_sms_sender ab

const fakeAudit = () => ({
  records: [],
  record(entry) {
    this.records.push(entry);
    return Promise.resolve();
  },
});
const fakeLogger = () => ({ log: () => {}, warn: () => {} });
const fakeStore = (state) => ({ load: () => state, save: () => {}, withStoreLock: (fn) => fn() });

// Ein Tenant mit einer aktiven Telnyx-DID, optional plattform-gebunden.
function seedTenantWithNumber({
  tenantId = "t1",
  e164 = CUSTOMER_DID,
  numberId = "n1",
  bound = false,
  bindingTenantId = null,
} = {}) {
  const state = makeDefaultState();
  registerTenant(state, tenantId);
  state.numbers.push({
    id: numberId,
    tenantId,
    e164,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: `ext_${numberId}`,
  });
  state.numberAssignments.push({ id: `a_${numberId}`, numberId, tenantId, assignedAt: "x", releasedAt: null });
  if (bound)
    bindPlatformNumber(state, {
      e164,
      purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI,
      provider: PROVIDER.TELNYX,
      tenantId: bindingTenantId,
    });
  return state;
}

test("T1: releaseNumber auf gebundene Nummer wirft, Status+e164 bleiben unangetastet", () => {
  const state = seedTenantWithNumber({ bound: true });
  assert.throws(() => releaseNumber(state, "n1"), /platform_number_in_use/);
  assert.equal(findNumber(state, "n1").status, NUMBER_STATUS.ACTIVE);
  assert.equal(findNumber(state, "n1").e164, CUSTOMER_DID);
});

test("T2: Uebergang nach SUSPENDED auf gebundene Nummer wirft ebenfalls", () => {
  const state = seedTenantWithNumber({ bound: true });
  assert.throws(
    () => transitionNumber(state, "n1", NUMBER_STATUS.SUSPENDED),
    /platform_number_in_use/,
  );
  assert.equal(findNumber(state, "n1").status, NUMBER_STATUS.ACTIVE);
});

test("T3 (POSITIV-KONTROLLE, Pflicht): eine NICHT gebundene Nummer wird weiterhin normal freigegeben", () => {
  const state = seedTenantWithNumber({ bound: false });
  const number = releaseNumber(state, "n1");
  assert.equal(number.status, NUMBER_STATUS.RELEASED);
  assert.equal(number.e164, null);
  assert.notEqual(state.numberAssignments[0].releasedAt, null);
});

test("T4: numberReleaseVerdict HOLD bei geteilter Bindung, RELEASE ohne Bindung", () => {
  const now = Date.parse("2026-08-27T12:00:00.000Z");
  const suspendedAtIso = new Date(now - THIRTY_DAYS_MS).toISOString();

  const bound = seedTenantWithNumber({ bound: true });
  bound.tenants.find((tenant) => tenant.id === "t1").status = TENANT_STATUS.SUSPENDED;
  bound.tenants.find((tenant) => tenant.id === "t1").suspendedAt = suspendedAtIso;
  const boundVerdict = numberReleaseVerdict(bound, findNumber(bound, "n1"), {
    nowMs: now,
    graceMs: FOURTEEN_DAYS_MS,
  });
  assert.equal(boundVerdict.action, RELEASE_VERDICT.HOLD);
  assert.equal(boundVerdict.reason, NUMBER_HOLD_REASON.PLATFORM_IN_USE);

  const free = seedTenantWithNumber({ bound: false });
  free.tenants.find((tenant) => tenant.id === "t1").status = TENANT_STATUS.SUSPENDED;
  free.tenants.find((tenant) => tenant.id === "t1").suspendedAt = suspendedAtIso;
  const freeVerdict = numberReleaseVerdict(free, findNumber(free, "n1"), {
    nowMs: now,
    graceMs: FOURTEEN_DAYS_MS,
  });
  assert.equal(freeVerdict.action, RELEASE_VERDICT.RELEASE);
});

test("T5: tenantNumbersForErase liefert Koerbe - die gebundene Nummer fehlt nicht, sie steht in hold", () => {
  const state = seedTenantWithNumber({ bound: true, numberId: "n1", e164: ANI });
  state.numbers.push({
    id: "n2",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_n2",
  });
  const buckets = tenantNumbersForErase(state, "t1");
  assert.equal(buckets.hold.length, 1);
  const [held] = buckets.hold;
  assert.equal(held.number.id, "n1");
  assert.equal(held.reason, NUMBER_HOLD_REASON.PLATFORM_IN_USE);
  assert.deepEqual(buckets.release.map((number) => number.id), ["n2"]);
});

test("T6: Orchestrator zaehlt HOLD als aborted, KEIN Provider-DELETE, GENAU EINE Audit-Zeile - keine E.164 im Detail", async () => {
  const state = seedTenantWithNumber({ bound: true });
  const provisioner = fakeProvisioner();
  const audit = fakeAudit();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(result, { released: 0, aborted: 1 });
  assert.deepEqual(provisioner.log, []);
  const abortedRecords = audit.records.filter((record) => record.action === "did_release_aborted");
  assert.equal(abortedRecords.length, 1);
  assert.match(abortedRecords[0].detail, /grund=platform_number_in_use/);
  assert.doesNotMatch(abortedRecords[0].detail, /\+\d/, "keine E.164 im Audit-Detail");
  assert.equal(findNumber(state, "n1").status, NUMBER_STATUS.ACTIVE);
});

test("T7 (Orchestrator-Positiv-Kontrolle): ungebundene DID wird ganz normal freigegeben", async () => {
  const state = seedTenantWithNumber({ bound: false });
  const provisioner = fakeProvisioner();
  const audit = fakeAudit();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(result, { released: 1, aborted: 0 });
  assert.deepEqual(provisioner.log, ["release:ext_n1"]);
  assert.ok(audit.records.some((record) => record.action === "did_released"));
  assert.equal(findNumber(state, "n1").status, NUMBER_STATUS.RELEASED);
});

test("T8: Kuendigung bleibt offen (numberReleasePending=true) bei gebundener DID; ungebunden schliesst", async () => {
  function fakeContractStore(state) {
    return {
      load: () => state,
      save: () => {},
      withStoreLock: (fn) => fn(),
      tenantIdpSubject: () => null,
      setContractEndCleanupPending: (tenantId, patch) => {
        const tenant = state.tenants.find((candidate) => candidate.id === tenantId);
        if (tenant) Object.assign(tenant, patch);
        return tenant ?? null;
      },
    };
  }
  const bound = seedTenantWithNumber({ bound: true });
  const boundResult = await attemptContractEndCleanup({
    store: fakeContractStore(bound),
    numberProvisioner: fakeProvisioner(),
    workos: null,
    auditStore: fakeAudit(),
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.equal(boundResult.numberReleasePending, true);

  const free = seedTenantWithNumber({ bound: false });
  const freeResult = await attemptContractEndCleanup({
    store: fakeContractStore(free),
    numberProvisioner: fakeProvisioner(),
    workos: null,
    auditStore: fakeAudit(),
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.equal(freeResult.numberReleasePending, false);
});

test("T9 (DSGVO): Loeschung entfernt ALLE personenbezogenen Daten, die Nummer wird trotzdem gehalten (Bindung bleibt offen)", () => {
  const state = seedTenantWithNumber({ bound: true });
  state.calls.push({ id: "c1", tenantId: "t1", status: "completed", transcript: [] });
  state.actionItems.push({ id: "ai1", tenantId: "t1", callId: "c1" });
  state.notifications.push({ id: "no1", tenantId: "t1", title: "x", body: "y", at: "x", callId: "c1" });
  state.tenants.find((tenant) => tenant.id === "t1").privateNumber = CUSTOMER_DID;

  eraseTenantData(state, "t1");

  assert.equal(state.calls.filter((call) => call.tenantId === "t1").length, 0);
  assert.equal(state.actionItems.filter((item) => item.tenantId === "t1").length, 0);
  assert.equal(state.notifications.filter((notif) => notif.tenantId === "t1").length, 0);
  assert.ok(!state.tenants.find((tenant) => tenant.id === "t1")?.privateNumber, "privateNumber ist weg");
  // die Nummer selbst bleibt gehalten - eraseTenantData fasst state.numbers nicht an,
  // und die Bindung bleibt offen (Art. 17 ist erfuellt, die DID-Miete nicht Teil davon).
  assert.equal(findNumber(state, "n1").status, NUMBER_STATUS.ACTIVE);
  assert.ok(platformNumberBinding(state, ANI) === null); // Sanity: falsche Nummer, kein Treffer
  assert.ok(platformNumberBinding(state, findNumber(state, "n1").e164) !== null, "Bindung bleibt offen");
});

test("T10: Unbind - eine Bindung, die dem freigebenden Tenant selbst gehoert, darf mit ihm gehen; die geteilte Plattform-ANI nicht", async () => {
  // Bindung gehoert GENAU dem freigebenden Tenant -> darf mit.
  const own = seedTenantWithNumber({ bound: true, bindingTenantId: "t1" });
  assert.equal(numberBusyReason(own, findNumber(own, "n1"), { forTenantId: "t1" }), null);
  const provisioner = fakeProvisioner();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(own),
    provisioner,
    audit: fakeAudit(),
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(result, { released: 1, aborted: 0 });
  assert.deepEqual(provisioner.log, ["release:ext_n1"]);

  // Gegenprobe: geteilte Plattform-ANI (tenantId=null) -> HOLD.
  const shared = seedTenantWithNumber({ bound: true, bindingTenantId: null });
  const sharedResult = await releaseTenantNumbersOnErase({
    store: fakeStore(shared),
    provisioner: fakeProvisioner(),
    audit: fakeAudit(),
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(sharedResult, { released: 0, aborted: 1 });
});

test("T11: laufender Anruf auf der Nummer haelt (HOLD active_call_on_number); nach Call-Ende Freigabe laeuft durch", async () => {
  const state = seedTenantWithNumber({ bound: false });
  state.calls.push({ id: "c1", tenantId: "t1", status: "active", from: CUSTOMER_DID, to: "+491700000000" });
  const busyResult = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner: fakeProvisioner(),
    audit: fakeAudit(),
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(busyResult, { released: 0, aborted: 1 });
  assert.equal(findNumber(state, "n1").status, NUMBER_STATUS.ACTIVE);

  state.calls[0].status = "completed";
  const freeResult = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner: fakeProvisioner(),
    audit: fakeAudit(),
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(freeResult, { released: 1, aborted: 0 });
});

test("T12: Boot leitet ZWEI Bindungen ab, idempotent - zweimal ableiten liefert dieselben zwei offenen Bindungen", () => {
  const state = makeDefaultState();
  state.numbers.push({
    id: "owner_n",
    tenantId: BOOTSTRAP_TENANT_ID,
    e164: ALERT_SENDER,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_owner",
  });
  const config = { provisioning: { platformAniE164: ANI } };
  const store = { load: () => state, save: () => {} };
  const first = derivePlatformNumberBindings({ config, store });
  assert.equal(first.length, TWO_DERIVED_BINDINGS);
  const second = derivePlatformNumberBindings({ config, store });
  assert.equal(second.length, TWO_DERIVED_BINDINGS);
  assert.deepEqual(
    first.map((binding) => binding.id).sort(),
    second.map((binding) => binding.id).sort(),
  );
  assert.ok(
    state.platformNumberUse.some(
      (binding) =>
        binding.purpose === PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI &&
        binding.e164 === ANI &&
        binding.releasedAt === null,
    ),
  );
  assert.ok(
    state.platformNumberUse.some(
      (binding) =>
        binding.purpose === PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER &&
        binding.e164 === ALERT_SENDER &&
        binding.releasedAt === null,
    ),
  );
});

test("T13: ANI-Wechsel schliesst die alte Bindung - der Rueckbau-Hebel funktioniert wirklich", () => {
  const state = makeDefaultState();
  syncPlatformBindings(state, [{ purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, e164: ANI, provider: PROVIDER.TELNYX }]);
  const firstOpen = state.platformNumberUse.find(
    (binding) => binding.purpose === PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI && binding.releasedAt === null,
  );
  assert.equal(firstOpen.e164, ANI);

  syncPlatformBindings(state, [
    { purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, e164: CUSTOMER_DID, provider: PROVIDER.TELNYX },
  ]);
  const oldBinding = state.platformNumberUse.find((binding) => binding.id === firstOpen.id);
  assert.notEqual(oldBinding.releasedAt, null, "alte Bindung ist geschlossen");
  const openOnes = state.platformNumberUse.filter(
    (binding) => binding.purpose === PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI && binding.releasedAt === null,
  );
  assert.equal(openOnes.length, 1);
  assert.equal(openOnes[0].e164, CUSTOMER_DID);
});

test("T14: Freigabe setzt e164=NULL - dieselbe Nummer ist danach erneut beschaffbar (kein UNIQUE-Konflikt)", () => {
  const state = seedTenantWithNumber({ bound: false });
  releaseNumber(state, "n1");
  assert.equal(findNumber(state, "n1").e164, null);
  // "Wiederkauf": eine neue Zeile mit DERSELBEN e164 darf ohne Kollision entstehen, weil
  // die alte Zeile die e164 nicht mehr traegt (number.e164 ist global UNIQUE, schema.sql).
  state.numbers.push({
    id: "n1_rebuy",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_rebuy",
  });
  assert.equal(state.numbers.filter((number) => number.e164 === CUSTOMER_DID).length, 1);
});

test("T15: leeres PLATFORM_ANI_E164 meldet sich; gesetzter Wert bleibt still; Text traegt keine Nummer", () => {
  const unset = platformAniFindings({ platformAniE164: "", elevenLabsOutboundEnabled: true });
  assert.equal(unset.length, 1);
  assert.equal(unset[0].fatal, false);
  assert.equal(unset[0].code, "platform_ani_unset_with_outbound");
  assert.doesNotMatch(unset[0].message, /\+\d{6,}/, "der Befundtext enthaelt keine Rufnummer");

  const unsetNoOutbound = platformAniFindings({ platformAniE164: "", elevenLabsOutboundEnabled: false });
  assert.equal(unsetNoOutbound[0].code, "platform_ani_unset");

  const set = platformAniFindings({ platformAniE164: ANI, elevenLabsOutboundEnabled: true });
  assert.deepEqual(set, []);
});
