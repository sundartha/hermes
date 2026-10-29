import { attachNumberRegistration } from "../state-ops.js";
import {
  DEFAULT_PROVIDER,
  DEFAULT_COUNTRY,
  NUMBER_STATUS,
  GLOBAL_CAP_REASON,
  NEEDS_MANUAL_RECONCILE_REASON,
  REQUEST_NUMBER_REASON,
  NUMBER_HOLD_REASON,
} from "../defaults.js";
import { languageForCountry } from "../../i18n/locales.js";
import { newId } from "./grundlagen.js";
import { findTenant, tenantMayRequestNumber } from "./mandant.js";

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

export function registrierungAnhaengen(zustand, numberId, providerAgentPhoneNumberId) {
  const number = attachNumberRegistration(zustand, numberId, providerAgentPhoneNumberId);
  return { ergebnis: number, geaendert: number.providerAgentPhoneNumberId === providerAgentPhoneNumberId };
}
