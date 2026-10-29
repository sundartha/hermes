import {
  normNum,
  E164,
  countryAllowed,
  allowedPrivateNumberCodes,
  NUMBER_STATUS,
  NUMBER_TRANSITIONS,
  TENANT_STATUS,
  KYC_LEVEL,
  KYC_ORDER,
} from "../defaults.js";
import { isKnownPlanSlug } from "../../plans.js";
import { isDenied } from "../../telephony/number-denylist.js";
import { tenantsOf } from "./grundlagen.js";

export function numberRecordByE164(state, e164) {
  if (!e164) return null;
  return state.numbers.find((number) => number.e164 === e164 && number.status === NUMBER_STATUS.ACTIVE) || null;
}

export function findTenantByNumber(state, e164) {
  return numberRecordByE164(state, e164)?.tenantId ?? null;
}

export function seedBootstrapIdpSubject(state, rawSub, tenantId) {
  const owner = findTenant(state, tenantId);
  if (!owner || owner.idpSubject) return false;
  const sub = typeof rawSub === "string" ? rawSub.trim() : "";
  if (!sub) return false;
  owner.idpSubject = sub;
  return true;
}

export function canTransitionNumber(from, to) {
  return (NUMBER_TRANSITIONS[from] || []).includes(to);
}

export function findNumber(state, id) {
  return state.numbers.find((number) => number.id === id) || null;
}

export function findTenant(state, id) {
  return tenantsOf(state).find((tenant) => tenant.id === id) || null;
}

export function applyOwnerIdentity(tenant, firstName, lastName) {
  const fn = typeof firstName === "string" ? firstName.trim() : "";
  const ln = typeof lastName === "string" ? lastName.trim() : "";
  const full = [fn, ln].filter(Boolean).join(" ");
  if (fn) tenant.firstName = fn;
  if (full) tenant.ownerName = full;
}

export function setTenantIdentityIfAbsent(state, tenantId, { firstName, lastName } = {}) {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.ownerName) return false;
  applyOwnerIdentity(tenant, firstName, lastName);
  return Boolean(tenant.ownerName);
}

export function setKycLevel(state, tenantId, level) {
  if (!KYC_ORDER.includes(level)) throw new Error(`setKycLevel: unbekannte KYC-Stufe ${level}`);
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setKycLevel: Tenant ${tenantId} nicht gefunden`);
  tenant.kycLevel = level;
  return tenant;
}

export function seedBootstrapKyc(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.kycLevel != null) return false;
  setKycLevel(state, tenantId, KYC_LEVEL.ID_VERIFIED);
  return true;
}

export function kycReached(state, tenantId, minLevel) {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.kycLevel == null) return false;
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

export function tenantActiveSubscriber(state, tenantId, minLevel) {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.status !== TENANT_STATUS.ACTIVE) return false;
  if (tenant.kycLevel == null) return false;
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

export function tenantInactive(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return !!tenant && tenant.status !== TENANT_STATUS.ACTIVE;
}

export function setSuspendedAtIfAbsent(state, tenantId, nowIso) {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.suspendedAt) return { tenant, changed: false };
  tenant.suspendedAt = nowIso;
  return { tenant, changed: true };
}

export function clearSuspendedAt(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  if (!tenant || !tenant.suspendedAt) return { tenant, changed: false };
  tenant.suspendedAt = null;
  return { tenant, changed: true };
}

export function tenantSuspendedAt(state, tenantId) {
  return findTenant(state, tenantId)?.suspendedAt ?? null;
}

export function setTenantStripe(
  state,
  tenantId,
  { customerId, paymentMethodId, paymentMethodType } = {},
) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setTenantStripe: Tenant ${tenantId} nicht gefunden`);
  if (customerId !== undefined) tenant.stripeCustomerId = customerId;
  if (paymentMethodId !== undefined) tenant.stripePaymentMethodId = paymentMethodId;
  if (paymentMethodType !== undefined) tenant.stripePaymentMethodType = paymentMethodType;
  return tenant;
}

export function tenantStripe(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return {
    customerId: tenant?.stripeCustomerId ?? null,
    paymentMethodId: tenant?.stripePaymentMethodId ?? null,
    paymentMethodType: tenant?.stripePaymentMethodType ?? null,
  };
}

const SUBSCRIPTION_FIELDS = [
  ["subscriptionId", "stripeSubscriptionId", null],
  ["planSlug", "stripePlanSlug", null],
  ["currentPeriodEnd", "stripeCurrentPeriodEnd", null],
  ["currentPeriodStart", "stripeCurrentPeriodStart", null],
  ["numberSetupFeeExempt", "stripeNumberSetupFeeExempt", false],
  ["activationPending", "stripeActivationPending", false],
  ["periodCreditRevoked", "stripePeriodCreditRevoked", false],
  ["cancelAtPeriodEnd", "stripeCancelAtPeriodEnd", false],
];

function assertKnownPlanSlug(planSlug) {
  if (planSlug != null && planSlug !== "" && !isKnownPlanSlug(planSlug)) {
    throw new Error(`setTenantSubscription: unbekannter Plan-Slug '${planSlug}' (kein Katalog-Eintrag)`);
  }
}

export function setTenantSubscription(state, tenantId, subscription = {}) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setTenantSubscription: Tenant ${tenantId} nicht gefunden`);
  assertKnownPlanSlug(subscription.planSlug);
  for (const [key, field] of SUBSCRIPTION_FIELDS) {
    if (subscription[key] !== undefined) tenant[field] = subscription[key];
  }
  return tenant;
}

export function tenantSubscription(state, tenantId) {
  const tenant = findTenant(state, tenantId) ?? {};
  const result = {};
  for (const [key, field, fallback] of SUBSCRIPTION_FIELDS) {
    result[key] = tenant[field] ?? fallback;
  }
  return result;
}

export function findTenantBySubscription(state, subscriptionId) {
  if (!subscriptionId) return null;
  return state.tenants.find((tenant) => tenant.stripeSubscriptionId === subscriptionId) ?? null;
}

export function findTenantByCustomer(state, customerId) {
  if (!customerId) return null;
  return state.tenants.find((tenant) => tenant.stripeCustomerId === customerId) ?? null;
}

export function tenantExists(state, tenantId) {
  return findTenant(state, tenantId) !== null;
}

export function setBillingHold(state, tenantId, { reason, dueAtIso = null } = {}) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return;
  tenant.billingHold = reason;
  tenant.billingHoldDueAt = dueAtIso;
}

export function clearBillingHold(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return;
  tenant.billingHold = null;
  tenant.billingHoldDueAt = null;
}

export function billingHoldActive(state, tenantId, nowIso) {
  const tenant = findTenant(state, tenantId);
  const reason = tenant?.billingHold ?? null;
  if (!reason) return null;
  const dueAtIso = tenant.billingHoldDueAt;
  if (!dueAtIso) return reason;
  return nowIso >= dueAtIso ? reason : null;
}

export function normalizePrivateNumber(raw, tenantCountryIso) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const e164 = normNum(raw);
  if (!E164.test(e164)) throw new Error("private number: ungueltiges E.164-Format");
  if (isDenied(e164)) throw new Error("private number: gesperrter Nummernbereich");
  if (!countryAllowed(e164, allowedPrivateNumberCodes(tenantCountryIso)))
    throw new Error("private number: Laendercode nicht erlaubt");
  return e164;
}

export function setPrivateNumber(state, tenantId, raw) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setPrivateNumber: Tenant ${tenantId} nicht gefunden`);
  const e164 = normalizePrivateNumber(raw, tenant.country);
  if (e164 === null) delete tenant.privateNumber;
  else tenant.privateNumber = e164;
  return tenant;
}

export function tenantPrivateNumber(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return tenant?.privateNumber ?? null;
}

export function setTenantGeo(state, tenantId, { country, defaultLanguage, timezone } = {}) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setTenantGeo: Tenant ${tenantId} nicht gefunden`);
  if (country !== undefined) tenant.country = country;
  if (defaultLanguage !== undefined) tenant.defaultLanguage = defaultLanguage;
  if (timezone !== undefined) tenant.timezone = timezone;
  return tenant;
}

export function tenantGeo(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return { country: tenant?.country ?? null, defaultLanguage: tenant?.defaultLanguage ?? null };
}

export function tenantTimezone(state, tenantId) {
  return findTenant(state, tenantId)?.timezone ?? null;
}

export function failedNumberCount(state, tenantId) {
  return state.numbers.filter(
    (number) => number.tenantId === tenantId && number.status === NUMBER_STATUS.FAILED,
  ).length;
}

export function tenantMayRequestNumber(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return false;
  if (tenant.status === TENANT_STATUS.ACTIVE) return true;
  if (tenant.status === TENANT_STATUS.CLOSED) return false;
  if (tenant.suspendedAt) return false;
  return tenant.stripeActivationPending === true;
}
