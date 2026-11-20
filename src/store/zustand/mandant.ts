import { normNum, E164, countryAllowed, allowedPrivateNumberCodes } from "../../begriffe/rufnummern.js";
import { NUMBER_STATUS, NUMBER_TRANSITIONS } from "../../begriffe/nummern.js";
import { TENANT_STATUS, KYC_LEVEL, KYC_ORDER } from "../../begriffe/mandant.js";
import { DEFAULT_LANGUAGE } from "../../konfiguration/standardsprache.ts";
import { isKnownPlanSlug } from "../../plans.ts";
import { isDenied } from "../../telephony/number-denylist.ts";
import { tenantsOf } from "./grundlagen.js";
import { settingsFor, calendarFor, type EinstellungenZustand } from "./einstellungen.ts";
import { seedTenantDefaultBudget } from "./budget.js";
import type { MandantRef } from "./grundzugriffe.ts";

export interface Mandant extends MandantRef {
  status: string;
  ownerName?: string;
  firstName?: string;
  kycLevel?: KycStufe | null;
  suspendedAt?: string | null;
  billingHold?: string | null | undefined;
  billingHoldDueAt?: string | null;
  privateNumber?: string;
  country?: string | null;
  defaultLanguage?: string | null;
  timezone?: string | null;
  stripeCustomerId?: string | null;
  stripePaymentMethodId?: string | null;
  stripePaymentMethodType?: string | null;
  stripeSubscriptionId?: string | null;
  stripeActivationPending?: boolean;
  numberProvisionSkipReason?: string | null;
  numberProvisionSkipAt?: string | null;
  numberReleasePending?: boolean;
  workosDeletePending?: boolean;
  [feld: string]: unknown;
}

export interface Nummer {
  id: string;
  tenantId: string;
  e164: string | null;
  status: string;
}

export interface MandantZustand extends EinstellungenZustand {
  tenants: Mandant[];
  numbers: Nummer[];
}

export type KycStufe = (typeof KYC_ORDER)[number];
type Kennung = string | null | undefined;

export function numberRecordByE164(state: MandantZustand, e164: Kennung): Nummer | null {
  if (!e164) return null;
  return state.numbers.find((number) => number.e164 === e164 && number.status === NUMBER_STATUS.ACTIVE) ?? null;
}

export function findTenantByNumber(state: MandantZustand, e164: Kennung): string | null {
  return numberRecordByE164(state, e164)?.tenantId ?? null;
}

export function seedBootstrapIdpSubject(state: MandantZustand, rawSub: unknown, tenantId: string): boolean {
  const owner = findTenant(state, tenantId);
  if (!owner || owner.idpSubject) return false;
  const sub = typeof rawSub === "string" ? rawSub.trim() : "";
  if (!sub) return false;
  owner.idpSubject = sub;
  return true;
}

const NUMBER_TRANSITION_MAP = new Map<string, readonly string[]>(Object.entries(NUMBER_TRANSITIONS));

export function canTransitionNumber(from: string, to: string): boolean {
  return (NUMBER_TRANSITION_MAP.get(from) ?? []).includes(to);
}

export function findNumber<N extends Nummer>(state: { numbers: N[] }, id: string): N | null {
  return state.numbers.find((number) => number.id === id) ?? null;
}

export function findTenant(state: MandantZustand, id: string): Mandant | null {
  return tenantsOf(state).find((tenant) => tenant.id === id) ?? null;
}

export function applyOwnerIdentity(tenant: Mandant, firstName: unknown, lastName: unknown): void {
  const fn = typeof firstName === "string" ? firstName.trim() : "";
  const ln = typeof lastName === "string" ? lastName.trim() : "";
  const full = [fn, ln].filter(Boolean).join(" ");
  if (fn) tenant.firstName = fn;
  if (full) tenant.ownerName = full;
}

export function setTenantIdentityIfAbsent(
  state: MandantZustand,
  tenantId: string,
  { firstName, lastName }: { firstName?: unknown; lastName?: unknown } = {},
): boolean {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.ownerName) return false;
  applyOwnerIdentity(tenant, firstName, lastName);
  return Boolean(tenant.ownerName);
}

export function setKycLevel(state: MandantZustand, tenantId: string, level: KycStufe): Mandant {
  if (!KYC_ORDER.includes(level)) throw new Error(`setKycLevel: unbekannte KYC-Stufe ${level}`);
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setKycLevel: Tenant ${tenantId} nicht gefunden`);
  tenant.kycLevel = level;
  return tenant;
}

export function seedBootstrapKyc(state: MandantZustand, tenantId: string): boolean {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.kycLevel != null) return false;
  setKycLevel(state, tenantId, KYC_LEVEL.ID_VERIFIED);
  return true;
}

export function kycReached(state: MandantZustand, tenantId: string, minLevel: KycStufe): boolean {
  const tenant = findTenant(state, tenantId);
  if (tenant?.kycLevel == null) return false;
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

export function tenantActiveSubscriber(state: MandantZustand, tenantId: string, minLevel: KycStufe): boolean {
  const tenant = findTenant(state, tenantId);
  if (tenant?.status !== TENANT_STATUS.ACTIVE) return false;
  if (tenant.kycLevel == null) return false;
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

export function tenantInactive(state: MandantZustand, tenantId: string): boolean {
  const tenant = findTenant(state, tenantId);
  return !!tenant && tenant.status !== TENANT_STATUS.ACTIVE;
}

export function setSuspendedAtIfAbsent(
  state: MandantZustand,
  tenantId: string,
  nowIso: string,
): { tenant: Mandant | null; changed: boolean } {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.suspendedAt) return { tenant, changed: false };
  tenant.suspendedAt = nowIso;
  return { tenant, changed: true };
}

export function clearSuspendedAt(state: MandantZustand, tenantId: string): { tenant: Mandant | null; changed: boolean } {
  const tenant = findTenant(state, tenantId);
  if (!tenant?.suspendedAt) return { tenant, changed: false };
  tenant.suspendedAt = null;
  return { tenant, changed: true };
}

export function tenantSuspendedAt(state: MandantZustand, tenantId: string): string | null {
  return findTenant(state, tenantId)?.suspendedAt ?? null;
}

export function setTenantStripe(
  state: MandantZustand,
  tenantId: string,
  {
    customerId,
    paymentMethodId,
    paymentMethodType,
  }: { customerId?: string | null; paymentMethodId?: string | null; paymentMethodType?: string | null } = {},
): Mandant {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setTenantStripe: Tenant ${tenantId} nicht gefunden`);
  if (customerId !== undefined) tenant.stripeCustomerId = customerId;
  if (paymentMethodId !== undefined) tenant.stripePaymentMethodId = paymentMethodId;
  if (paymentMethodType !== undefined) tenant.stripePaymentMethodType = paymentMethodType;
  return tenant;
}

export function tenantStripe(
  state: MandantZustand,
  tenantId: string,
): { customerId: string | null; paymentMethodId: string | null; paymentMethodType: string | null } {
  const tenant = findTenant(state, tenantId);
  return {
    customerId: tenant?.stripeCustomerId ?? null,
    paymentMethodId: tenant?.stripePaymentMethodId ?? null,
    paymentMethodType: tenant?.stripePaymentMethodType ?? null,
  };
}

interface AboLesung {
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
  [feld: string]: unknown;
}

interface AboPatch {
  planSlug?: string | null;
  [feld: string]: unknown;
}

export const SUBSCRIPTION_PATCH_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  subscriptionId: "stripeSubscriptionId",
  planSlug: "stripePlanSlug",
  currentPeriodEnd: "stripeCurrentPeriodEnd",
  currentPeriodStart: "stripeCurrentPeriodStart",
  numberSetupFeeExempt: "stripeNumberSetupFeeExempt",
  activationPending: "stripeActivationPending",
  periodCreditRevoked: "stripePeriodCreditRevoked",
  cancelAtPeriodEnd: "stripeCancelAtPeriodEnd",
});

const SUBSCRIPTION_READ_DEFAULTS: Readonly<Record<string, boolean | null>> = Object.freeze({
  subscriptionId: null,
  planSlug: null,
  currentPeriodEnd: null,
  currentPeriodStart: null,
  numberSetupFeeExempt: false,
  activationPending: false,
  periodCreditRevoked: false,
  cancelAtPeriodEnd: false,
});

function assertKnownPlanSlugIfSet(planSlug: string | null | undefined): void {
  if (planSlug != null && planSlug !== "" && !isKnownPlanSlug(planSlug)) {
    throw new Error(`setTenantSubscription: unbekannter Plan-Slug '${planSlug}' (kein Katalog-Eintrag)`);
  }
}

function applySubscriptionPatch(tenant: Mandant, patch: AboPatch): void {
  for (const [key, field] of Object.entries(SUBSCRIPTION_PATCH_FIELDS)) {
    if (patch[key] !== undefined) tenant[field] = patch[key];
  }
}

export function setTenantSubscription(state: MandantZustand, tenantId: string, patch: AboPatch = {}): Mandant {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setTenantSubscription: Tenant ${tenantId} nicht gefunden`);
  assertKnownPlanSlugIfSet(patch.planSlug);
  applySubscriptionPatch(tenant, patch);
  return tenant;
}

export function tenantSubscription(state: MandantZustand, tenantId: string): AboLesung {
  const tenant = findTenant(state, tenantId);
  const result: AboLesung = {};
  for (const [key, field] of Object.entries(SUBSCRIPTION_PATCH_FIELDS)) {
    result[key] = tenant?.[field] ?? SUBSCRIPTION_READ_DEFAULTS[key];
  }
  return result;
}

export function findTenantBySubscription(state: MandantZustand, subscriptionId: Kennung): Mandant | null {
  if (!subscriptionId) return null;
  return state.tenants.find((tenant) => tenant.stripeSubscriptionId === subscriptionId) ?? null;
}

export function findTenantByCustomer(state: MandantZustand, customerId: Kennung): Mandant | null {
  if (!customerId) return null;
  return state.tenants.find((tenant) => tenant.stripeCustomerId === customerId) ?? null;
}

export function tenantExists(state: MandantZustand, tenantId: string): boolean {
  return findTenant(state, tenantId) !== null;
}

export function setBillingHold(
  state: MandantZustand,
  tenantId: string,
  { reason, dueAtIso = null }: { reason?: string | null; dueAtIso?: string | null } = {},
): void {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return;
  tenant.billingHold = reason;
  tenant.billingHoldDueAt = dueAtIso;
}

export function clearBillingHold(state: MandantZustand, tenantId: string): void {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return;
  tenant.billingHold = null;
  tenant.billingHoldDueAt = null;
}

export function billingHoldActive(state: MandantZustand, tenantId: string, nowIso: string): string | null {
  const tenant = findTenant(state, tenantId);
  const reason = tenant?.billingHold ?? null;
  if (!reason) return null;
  const dueAtIso = tenant?.billingHoldDueAt;
  if (!dueAtIso) return reason;
  return nowIso >= dueAtIso ? reason : null;
}

export function normalizePrivateNumber(raw: unknown, tenantCountryIso?: string | null): string | null {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const e164 = normNum(raw);
  if (!E164.test(e164)) throw new Error("private number: ungueltiges E.164-Format");
  if (isDenied(e164)) throw new Error("private number: gesperrter Nummernbereich");
  if (!countryAllowed(e164, allowedPrivateNumberCodes(tenantCountryIso)))
    throw new Error("private number: Laendercode nicht erlaubt");
  return e164;
}

export function setPrivateNumber(state: MandantZustand, tenantId: string, raw: unknown): Mandant {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setPrivateNumber: Tenant ${tenantId} nicht gefunden`);
  const e164 = normalizePrivateNumber(raw, tenant.country);
  if (e164 === null) delete tenant.privateNumber;
  else tenant.privateNumber = e164;
  return tenant;
}

export function tenantPrivateNumber(state: MandantZustand, tenantId: string): string | null {
  const tenant = findTenant(state, tenantId);
  return tenant?.privateNumber ?? null;
}

export function setTenantGeo(
  state: MandantZustand,
  tenantId: string,
  {
    country,
    defaultLanguage,
    timezone,
  }: { country?: string | null; defaultLanguage?: string | null; timezone?: string | null } = {},
): Mandant {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setTenantGeo: Tenant ${tenantId} nicht gefunden`);
  if (country !== undefined) tenant.country = country;
  if (defaultLanguage !== undefined) tenant.defaultLanguage = defaultLanguage;
  if (timezone !== undefined) tenant.timezone = timezone;
  return tenant;
}

export function tenantGeo(
  state: MandantZustand,
  tenantId: string,
): { country: string | null; defaultLanguage: string | null } {
  const tenant = findTenant(state, tenantId);
  return { country: tenant?.country ?? null, defaultLanguage: tenant?.defaultLanguage ?? null };
}

export function tenantTimezone(state: MandantZustand, tenantId: string): string | null {
  return findTenant(state, tenantId)?.timezone ?? null;
}

export function failedNumberCount(state: MandantZustand, tenantId: string): number {
  return state.numbers.filter(
    (number) => number.tenantId === tenantId && number.status === NUMBER_STATUS.FAILED,
  ).length;
}

export function tenantMayRequestNumber(state: MandantZustand, tenantId: string): boolean {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return false;
  if (tenant.status === TENANT_STATUS.ACTIVE) return true;
  if (tenant.status === TENANT_STATUS.CLOSED) return false;
  if (tenant.suspendedAt) return false;
  return tenant.stripeActivationPending === true;
}

interface MandantKontext {
  tenantId: string;
  ownerName: unknown;
  firstName: string;
  settings: ReturnType<typeof settingsFor>;
  calendar: ReturnType<typeof calendarFor>;
}

export function tenantContext(state: MandantZustand, ownerName: unknown, tenantId: string): MandantKontext {
  const tenant = findTenant(state, tenantId);
  const effectiveOwner = (tenant?.ownerName ?? "") || ownerName;
  return {
    tenantId,
    ownerName: effectiveOwner,
    firstName: (tenant?.firstName ?? "") || firstNameOf(effectiveOwner),
    settings: settingsFor(state, tenantId),
    calendar: calendarFor(state, tenantId),
  };
}

function firstNameOf(fullName: unknown): string {
  return typeof fullName === "string" ? fullName.trim().split(/\s+/)[0] ?? "" : "";
}

export function resolveCallLanguage(
  state: MandantZustand,
  { tenantId, numberRecord }: { tenantId: string; numberRecord?: { language?: string | null } | null | undefined },
): string {
  const settingsLang = settingsFor(state, tenantId).language;
  const tenant = findTenant(state, tenantId);
  return (settingsLang ?? "") || (numberRecord?.language ?? "") || (tenant?.defaultLanguage ?? "") || DEFAULT_LANGUAGE;
}

export function registerTenant(
  state: MandantZustand,
  id: string,
  {
    firstName,
    lastName,
    privateNumber,
    idpSubject,
    defaultBudgetCents,
    country,
  }: {
    firstName?: unknown;
    lastName?: unknown;
    privateNumber?: unknown;
    idpSubject?: string | null;
    defaultBudgetCents?: number | null;
    country?: string | null;
  } = {},
): Mandant {
  const e164 = normalizePrivateNumber(privateNumber, country);
  const existing = findTenant(state, id);
  if (existing) {
    if (idpSubject && !existing.idpSubject) existing.idpSubject = idpSubject;
    if (!existing.ownerName) applyOwnerIdentity(existing, firstName, lastName);
    if (e164 && !existing.privateNumber) existing.privateNumber = e164;
    seedTenantDefaultBudget(state, id, defaultBudgetCents);
    return existing;
  }
  const tenant: Mandant = { id, status: TENANT_STATUS.ACTIVE };
  applyOwnerIdentity(tenant, firstName, lastName);
  if (idpSubject) tenant.idpSubject = idpSubject;
  if (e164) tenant.privateNumber = e164;
  state.tenants.push(tenant);
  seedTenantDefaultBudget(state, id, defaultBudgetCents);
  return tenant;
}
