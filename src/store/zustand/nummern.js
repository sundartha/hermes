import {
  DEFAULT_PROVIDER,
  DEFAULT_COUNTRY,
  PROVIDER,
  NUMBER_STATUS,
  PROVISIONING_JOB_STATUS,
  PROVISION_NUMBER_JOB,
  GLOBAL_CAP_REASON,
  NEEDS_MANUAL_RECONCILE_REASON,
  REQUEST_NUMBER_REASON,
  NUMBER_HOLD_REASON,
} from "../defaults.js";
import { languageForCountry } from "../../i18n/locales.js";
import { resolvePeriodStartIso } from "../../billing/period.js";
import { newId, tenantsOf } from "./grundlagen.js";
import {
  canTransitionNumber,
  findNumber,
  findTenant,
  tenantActiveSubscriber,
  tenantMayRequestNumber,
  tenantSuspendedAt,
  tenantSubscription,
} from "./mandant.js";

function occupiesCapacity(number) {
  return number.status !== NUMBER_STATUS.RELEASED && number.status !== NUMBER_STATUS.FAILED;
}

function liveNumbers(state, tenantId = null) {
  return state.numbers.filter((number) => occupiesCapacity(number) && (tenantId == null || number.tenantId === tenantId));
}

export function tenantHasLiveNumber(state, tenantId) {
  return liveNumbers(state, tenantId).length > 0;
}

function markNumberProvisionSkipped(tenant, reason) {
  tenant.numberProvisionSkipReason = reason;
  tenant.numberProvisionSkipAt = new Date().toISOString();
}

function clearNumberProvisionSkip(tenant) {
  tenant.numberProvisionSkipReason = null;
  tenant.numberProvisionSkipAt = null;
}

export function markTenantNeedsManualReconcile(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.numberProvisionSkipReason === NEEDS_MANUAL_RECONCILE_REASON)
    return { tenant: tenant ?? null, changed: false };
  markNumberProvisionSkipped(tenant, NEEDS_MANUAL_RECONCILE_REASON);
  return { tenant, changed: true };
}

export function requestNumber(
  state,
  {
    tenantId,
    provider = DEFAULT_PROVIDER,
    country = DEFAULT_COUNTRY,
    language = languageForCountry(country),
    maxNumbers,
    maxNumbersPerTenant,
  },
) {
  const tenant = findTenant(state, tenantId);
  if (!tenantMayRequestNumber(state, tenantId))
    return { ok: false, reason: REQUEST_NUMBER_REASON.TENANT_INACTIVE };
  if (liveNumbers(state).length >= maxNumbers) {
    markNumberProvisionSkipped(tenant, GLOBAL_CAP_REASON);
    return { ok: false, reason: GLOBAL_CAP_REASON };
  }
  if (liveNumbers(state, tenantId).length >= maxNumbersPerTenant)
    return { ok: false, reason: REQUEST_NUMBER_REASON.TENANT_CAP };
  const number = {
    id: newId("num"),
    e164: null,
    tenantId,
    provider,
    country,
    language,
    status: NUMBER_STATUS.REQUESTED,
    providerNumberId: null,
    paymentIntentId: null,
  };
  state.numbers.push(number);
  clearNumberProvisionSkip(tenant);
  return { ok: true, number };
}

const CALL_STATUS_ACTIVE = "active";

function isOpenBinding(binding) {
  return binding.releasedAt === null;
}

function findOpenBinding(state, e164, purpose) {
  return state.platformNumberUse.find(
    (binding) => binding.e164 === e164 && binding.purpose === purpose && isOpenBinding(binding),
  );
}

function closingTimestamp() {
  return new Date().toISOString();
}

export function platformNumberBindings(state, e164) {
  if (!e164) return [];
  return state.platformNumberUse.filter((binding) => binding.e164 === e164 && isOpenBinding(binding));
}

export function openPlatformBindingByPurpose(state, purpose) {
  return state.platformNumberUse.find((binding) => binding.purpose === purpose && isOpenBinding(binding));
}

function bindingBelongsTo(binding, tenantId) {
  return binding.tenantId === tenantId;
}

export function numberBusyReason(state, number, { forTenantId = null } = {}) {
  const bindings = platformNumberBindings(state, number.e164);
  const blockedByForeignBinding = bindings.some(
    (binding) => forTenantId === null || !bindingBelongsTo(binding, forTenantId),
  );
  if (blockedByForeignBinding) return NUMBER_HOLD_REASON.PLATFORM_IN_USE;
  if (
    number.e164 &&
    state.calls.some(
      (call) => call.status === CALL_STATUS_ACTIVE && (call.from === number.e164 || call.to === number.e164),
    )
  )
    return NUMBER_HOLD_REASON.ACTIVE_CALL;
  return null;
}

export function bindPlatformNumber(state, { e164, purpose, provider, tenantId = null, providerNumberId = null, note = null }) {
  const open = findOpenBinding(state, e164, purpose);
  if (open) return open;
  const binding = {
    id: newId("pnu"), e164, purpose, provider, tenantId, providerNumberId,
    boundAt: new Date().toISOString(), releasedAt: null, note,
  };
  state.platformNumberUse.push(binding);
  return binding;
}

export function unbindPlatformNumber(state, { e164, purpose }) {
  const open = findOpenBinding(state, e164, purpose);
  if (!open) return null;
  open.releasedAt = closingTimestamp();
  return open;
}

export function unbindOwnPlatformBindings(state, number) {
  if (!number.e164) return [];
  const closed = [];
  for (const binding of platformNumberBindings(state, number.e164)) {
    if (!bindingBelongsTo(binding, number.tenantId)) continue;
    binding.releasedAt = closingTimestamp();
    closed.push(binding);
  }
  return closed;
}

export function syncPlatformBindings(state, desired) {
  for (const { purpose, e164, provider, tenantId = null, note = null } of desired) {
    for (const binding of state.platformNumberUse)
      if (binding.purpose === purpose && isOpenBinding(binding) && binding.e164 !== e164)
        binding.releasedAt = closingTimestamp();
    if (e164) bindPlatformNumber(state, { e164, purpose, provider, tenantId, note });
  }
  return state.platformNumberUse.filter(isOpenBinding);
}

export function openOutageAlert(state, code) {
  return state.outageAlerts.find((alert) => alert.code === code && alert.closedAt === null);
}

export function claimOutageAlert(state, { code, nowMs, sent = false, channels = [] }) {
  const nowIso = new Date(nowMs).toISOString();
  let marker = openOutageAlert(state, code);
  if (marker) {
    marker.lastSeenAt = nowIso;
  } else {
    marker = {
      id: newId("otg"),
      code,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastAttemptAt: null,
      reportedAt: null,
      deliveredChannels: null,
      closedAt: null,
    };
    state.outageAlerts.push(marker);
  }
  if (sent) {
    marker.lastAttemptAt = nowIso;
    if (channels.length > 0) {
      marker.reportedAt = nowIso;
      marker.deliveredChannels = channels.join(",");
    }
  }
  return marker;
}

export function closeOutageAlert(state, { code, nowMs }) {
  const marker = openOutageAlert(state, code);
  if (!marker) return null;
  marker.closedAt = new Date(nowMs).toISOString();
  return marker;
}

const NUMBER_OUT_OF_SERVICE = new Set([NUMBER_STATUS.RELEASED, NUMBER_STATUS.SUSPENDED]);

export function transitionNumber(state, numberId, toStatus) {
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`transitionNumber: Nummer ${numberId} nicht gefunden`);
  if (!canTransitionNumber(number.status, toStatus))
    throw new Error(`transitionNumber: illegaler Uebergang ${number.status} -> ${toStatus}`);
  if (NUMBER_OUT_OF_SERVICE.has(toStatus)) {
    const busy = numberBusyReason(state, number);
    if (busy)
      throw new Error(
        `transitionNumber: Nummer ${numberId} ist gesperrt (${busy}) - Uebergang nach ${toStatus} abgelehnt`,
      );
  }
  number.status = toStatus;
  return number;
}

export function beginProvisioning(state, numberId) {
  return transitionNumber(state, numberId, NUMBER_STATUS.PROVISIONING);
}

export function attachNumberPaymentIntent(state, numberId, paymentIntentId) {
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`attachNumberPaymentIntent: Nummer ${numberId} nicht gefunden`);
  number.paymentIntentId = paymentIntentId;
  return number;
}

export function attachNumberRegistration(state, numberId, providerAgentPhoneNumberId) {
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`attachNumberRegistration: Nummer ${numberId} nicht gefunden`);
  if (number.providerAgentPhoneNumberId) return number;
  number.providerAgentPhoneNumberId = providerAgentPhoneNumberId;
  return number;
}

const INBOUND_TRUNK_BELEG_FELDER = Object.freeze(["elInboundTrunkBelegtAt", "elInboundTrunkZugangFp"]);

function hatInboundTrunkBeleg(number) {
  return INBOUND_TRUNK_BELEG_FELDER.some((feld) => number[feld] !== undefined && number[feld] !== null);
}

export function markNumberElInboundTrunkBelegt(state, numberId, { nowIso, zugangFp }) {
  if (!nowIso || !zugangFp) throw new Error("markNumberElInboundTrunkBelegt: nowIso und zugangFp sind Pflicht");
  const number = findNumber(state, numberId);
  if (number?.status !== NUMBER_STATUS.ACTIVE) return { number, changed: false };
  if (number.elInboundTrunkZugangFp === zugangFp && number.elInboundTrunkBelegtAt) return { number, changed: false };
  number.elInboundTrunkBelegtAt = nowIso;
  number.elInboundTrunkZugangFp = zugangFp;
  return { number, changed: true };
}

export function clearNumberElInboundTrunkBeleg(state, numberId) {
  const number = findNumber(state, numberId);
  if (!number || !hatInboundTrunkBeleg(number)) return { number, changed: false };
  for (const feld of INBOUND_TRUNK_BELEG_FELDER) delete number[feld];
  return { number, changed: true };
}

export function beginCapturing(state, numberId) {
  return transitionNumber(state, numberId, NUMBER_STATUS.CAPTURING);
}

export function activateNumber(
  state,
  numberId,
  { e164, providerNumberId, monthlyCostCents = null },
) {
  const number = transitionNumber(state, numberId, NUMBER_STATUS.ACTIVE);
  number.e164 = e164;
  number.providerNumberId = providerNumberId ?? null;
  if (monthlyCostCents !== null) number.monthlyCostCents = monthlyCostCents;
  state.numberAssignments.push({
    id: newId("asg"),
    numberId: number.id,
    tenantId: number.tenantId,
    assignedAt: new Date().toISOString(),
    releasedAt: null,
  });
  return number;
}

export function failNumber(state, numberId) {
  return transitionNumber(state, numberId, NUMBER_STATUS.FAILED);
}

export function releaseNumber(state, numberId) {
  const number = transitionNumber(state, numberId, NUMBER_STATUS.RELEASED);
  number.e164 = null;
  number.providerAgentPhoneNumberId = null;
  for (const feld of INBOUND_TRUNK_BELEG_FELDER) delete number[feld];
  const asg = state.numberAssignments.find(
    (assignment) => assignment.numberId === numberId && !assignment.releasedAt,
  );
  if (asg) asg.releasedAt = new Date().toISOString();
  return number;
}

export function recordProvisioningJob(state, { numberId, tenantId, idempotencyKey }) {
  const existing = state.provisioningJobs.find((j) => j.idempotencyKey === idempotencyKey);
  if (existing) return existing;
  const job = {
    id: newId("job"),
    numberId,
    tenantId,
    kind: PROVISION_NUMBER_JOB,
    status: PROVISIONING_JOB_STATUS.QUEUED,
    idempotencyKey,
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  state.provisioningJobs.push(job);
  return job;
}

const PROVISION_CLOSE_NUMBER_STATUS = new Set([
  NUMBER_STATUS.ACTIVE,
  NUMBER_STATUS.FAILED,
  NUMBER_STATUS.RELEASED,
  NUMBER_STATUS.SUSPENDED,
]);

export function redriveAgeHoldReason(job, nowMs, maxAgeMs) {
  const createdMs = Date.parse(job.createdAt ?? "");
  if (!job.createdAt || Number.isNaN(createdMs)) return "unknown_age";
  if (nowMs - createdMs > maxAgeMs) return "too_old";
  return null;
}

export function classifyQueuedProvisioningJobs(state, { nowMs, maxAgeMs, kycMinLevel }) {
  const buckets = { close: [], hold: [], redrive: [] };
  for (const job of state.provisioningJobs) {
    if (job.status !== PROVISIONING_JOB_STATUS.QUEUED) continue;
    const number = findNumber(state, job.numberId);
    if (!number || PROVISION_CLOSE_NUMBER_STATUS.has(number.status)) {
      buckets.close.push(job);
      continue;
    }
    if (number.status !== NUMBER_STATUS.REQUESTED) {
      buckets.hold.push({ job, reason: `mid_flight_${number.status}` });
      continue;
    }
    if (!tenantActiveSubscriber(state, job.tenantId, kycMinLevel)) {
      buckets.hold.push({ job, reason: "no_active_subscriber" });
      continue;
    }
    const ageHoldReason = redriveAgeHoldReason(job, nowMs, maxAgeMs);
    if (ageHoldReason) {
      buckets.hold.push({ job, reason: ageHoldReason });
      continue;
    }
    buckets.redrive.push(job);
  }
  return buckets;
}

export const RELEASE_VERDICT = Object.freeze({ RELEASE: "release", HOLD: "hold", SKIP: "skip" });

export function numberReleaseVerdict(state, number, { nowMs, graceMs }) {
  if (number.status !== NUMBER_STATUS.ACTIVE)
    return { action: RELEASE_VERDICT.SKIP, reason: `not_active_${number.status}` };
  const suspendedAt = tenantSuspendedAt(state, number.tenantId);
  if (!suspendedAt) return { action: RELEASE_VERDICT.SKIP, reason: "tenant_not_suspended" };
  const suspendedMs = Date.parse(suspendedAt);
  if (Number.isNaN(suspendedMs))
    return { action: RELEASE_VERDICT.SKIP, reason: "suspended_at_unparsebar" };
  if (nowMs - suspendedMs <= graceMs)
    return { action: RELEASE_VERDICT.SKIP, reason: "grace_not_reached" };
  const busy = numberBusyReason(state, number, { forTenantId: number.tenantId });
  if (busy) return { action: RELEASE_VERDICT.HOLD, reason: busy };
  if (number.provider !== PROVIDER.TELNYX)
    return { action: RELEASE_VERDICT.HOLD, reason: NUMBER_HOLD_REASON.NON_TELNYX };
  return { action: RELEASE_VERDICT.RELEASE, reason: null };
}

export function classifyNumbersForRelease(state, { nowMs, graceMs }) {
  const buckets = { release: [], hold: [], skip: [] };
  for (const number of state.numbers) {
    const { action, reason } = numberReleaseVerdict(state, number, { nowMs, graceMs });
    if (action === RELEASE_VERDICT.RELEASE) buckets.release.push(number);
    else if (action === RELEASE_VERDICT.HOLD) buckets.hold.push({ number, reason });
    else buckets.skip.push({ number, reason });
  }
  return buckets;
}

export function tenantNumbersForErase(state, tenantId) {
  const buckets = { release: [], hold: [] };
  for (const number of state.numbers) {
    if (number.tenantId !== tenantId) continue;
    if (number.status !== NUMBER_STATUS.ACTIVE) continue;
    if (number.provider !== PROVIDER.TELNYX) continue;
    const busy = numberBusyReason(state, number, { forTenantId: tenantId });
    if (busy) buckets.hold.push({ number: number, reason: busy });
    else buckets.release.push(number);
  }
  return buckets;
}

export function setContractEndCleanupPending(
  state,
  tenantId,
  { numberReleasePending, workosDeletePending } = {},
) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return null;
  if (numberReleasePending !== undefined) tenant.numberReleasePending = numberReleasePending;
  if (workosDeletePending !== undefined) tenant.workosDeletePending = workosDeletePending;
  return tenant;
}

export function contractEndCleanupPending(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return {
    numberReleasePending: tenant?.numberReleasePending ?? false,
    workosDeletePending: tenant?.workosDeletePending ?? false,
  };
}

export function tenantsPendingContractEndCleanup(state) {
  return tenantsOf(state).filter(
    (tenant) => tenant.numberReleasePending || tenant.workosDeletePending,
  );
}

export function platformHoldEscalationCandidates(state, { nowMs, maxAgeMs }) {
  const candidates = [];
  for (const tenant of tenantsPendingContractEndCleanup(state)) {
    if (!tenant.numberReleasePending) continue;
    const suspendedMs = Date.parse(tenant.suspendedAt ?? "");
    if (Number.isNaN(suspendedMs)) continue;
    if (nowMs - suspendedMs <= maxAgeMs) continue;
    const { hold } = tenantNumbersForErase(state, tenant.id);
    for (const { number, reason } of hold)
      if (reason === NUMBER_HOLD_REASON.PLATFORM_IN_USE) candidates.push(number);
  }
  return candidates;
}

export function paidWithoutNumberCandidates(state, { nowMs, graceMs, kycMinLevel }) {
  const candidates = [];
  for (const tenant of state.tenants) {
    if (!tenantActiveSubscriber(state, tenant.id, kycMinLevel)) continue;
    if (tenantHasLiveNumber(state, tenant.id)) continue;
    const paidSinceIso = resolvePeriodStartIso(tenantSubscription(state, tenant.id));
    if (!paidSinceIso) continue;
    const paidSinceMs = Date.parse(paidSinceIso);
    if (Number.isNaN(paidSinceMs)) continue;
    if (nowMs - paidSinceMs <= graceMs) continue;
    candidates.push({ tenantId: tenant.id, paidSinceIso });
  }
  return candidates;
}

export function registrierungAnhaengen(zustand, numberId, providerAgentPhoneNumberId) {
  const number = attachNumberRegistration(zustand, numberId, providerAgentPhoneNumberId);
  return { ergebnis: number, geaendert: number.providerAgentPhoneNumberId === providerAgentPhoneNumberId };
}
