import {
  DEFAULT_PROVIDER,
  PROVIDER,
  PROVISION_NUMBER_JOB,
  NUMBER_SWAP_JOB,
  SWAP_ATTEMPTS_MAX,
  TAUSCH_ERGEBNIS,
  GLOBAL_CAP_REASON,
  NEEDS_MANUAL_RECONCILE_REASON,
  REQUEST_NUMBER_REASON,
  NUMBER_HOLD_REASON,
} from "../../begriffe/nummern-vergabe.js";
import { DEFAULT_COUNTRY } from "../../begriffe/sprache-zeit.js";
import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../../begriffe/nummern.js";
import { USAGE_EVENT_KIND } from "../../begriffe/abrechnung.ts";
import { BOOTSTRAP_TENANT_ID } from "../../begriffe/mandant.js";
import { hatKaufbareVorwahl, kauflandFuer, normNum } from "../../begriffe/rufnummern.js";
import { languageForCountry } from "../../i18n/locales.ts";
import { resolvePeriodStartIso } from "../../billing/period.ts";
import { newId, tenantsOf } from "./grundlagen.js";
import { swapKey, ersatzZuAlterNummer } from "./tauschschluessel.ts";
export { swapKey, ersatzZuAlterNummer } from "./tauschschluessel.ts";
import { spendMonthKeyOf } from "./nutzung.js";
import {
  canTransitionNumber,
  findNumber,
  findTenant,
  tenantActiveSubscriber,
  tenantMayRequestNumber,
  tenantSuspendedAt,
  tenantSubscription,
  type KycStufe,
  type Mandant,
  type MandantZustand,
  type Nummer,
} from "./mandant.ts";

interface Nummernsatz extends Nummer {
  provider?: string;
  country?: string | undefined;
  language?: string | null;
  providerNumberId?: string | null;
  paymentIntentId?: string | null;
  providerAgentPhoneNumberId?: string | null;
  monthlyCostCents?: number;
  elInboundTrunkBelegtAt?: string | null;
  elInboundTrunkZugangFp?: string | null;
}

interface Bereitstellung {
  id: string;
  numberId: string;
  tenantId: string;
  kind: string;
  status: string;
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  createdAt?: string | null;
}

interface Zuweisung {
  id: string;
  numberId: string;
  tenantId: string;
  assignedAt: string;
  releasedAt: string | null;
}

interface PlattformBindung {
  id: string;
  e164: string;
  purpose: string;
  provider: string;
  tenantId: string | null;
  providerNumberId: string | null;
  boundAt: string;
  releasedAt: string | null;
  note: string | null;
}

interface Ausfallmarke {
  id: string;
  code: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAttemptAt: string | null;
  reportedAt: string | null;
  deliveredChannels: string | null;
  closedAt: string | null;
}

interface NummernAnruf {
  status: string;
  from?: string | null;
  to?: string | null;
}

interface Nutzungsereignis {
  kind: string;
  numberId?: string | null;
  occurredAt?: string;
}

interface MitNummern { numbers: Nummernsatz[] }
interface MitJobs { provisioningJobs: Bereitstellung[] }
interface MitBindungen { platformNumberUse: PlattformBindung[] }
interface MitAnrufen { calls: NummernAnruf[] }
interface MitMarken { outageAlerts: Ausfallmarke[] }
interface MitZuweisungen { numberAssignments: Zuweisung[] }
interface MitNutzung { usageEvents: Nutzungsereignis[] }
type MandantUndNummern = Omit<MandantZustand, "numbers"> & MitNummern;
type Uebergang = MitNummern & MitBindungen & MitAnrufen;
export type NummernZustand = MandantUndNummern &
  MitJobs &
  MitBindungen &
  MitAnrufen &
  MitMarken &
  MitZuweisungen &
  MitNutzung;

type Kennung = string | null | undefined;
interface Tauschergebnis {
  ergebnis: { ok: false; grund: string } | { ok: true; number: Nummernsatz; purchase: boolean };
  geaendert?: boolean;
}

function occupiesCapacity(number: Nummernsatz): boolean {
  return number.status !== NUMBER_STATUS.RELEASED && number.status !== NUMBER_STATUS.FAILED;
}

function liveNumbers(state: MitNummern, tenantId: string | null = null): Nummernsatz[] {
  return state.numbers.filter((number) => occupiesCapacity(number) && (tenantId == null || number.tenantId === tenantId));
}

export function tenantHasLiveNumber(state: MitNummern, tenantId: string): boolean {
  return liveNumbers(state, tenantId).length > 0;
}

function markNumberProvisionSkipped(tenant: Mandant, reason: string): void {
  tenant.numberProvisionSkipReason = reason;
  tenant.numberProvisionSkipAt = new Date().toISOString();
}

function clearNumberProvisionSkip(tenant: Mandant): void {
  tenant.numberProvisionSkipReason = null;
  tenant.numberProvisionSkipAt = null;
}

export function markTenantNeedsManualReconcile(
  state: MandantZustand,
  tenantId: string,
): { tenant: Mandant | null; changed: boolean } {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.numberProvisionSkipReason === NEEDS_MANUAL_RECONCILE_REASON)
    return { tenant: tenant ?? null, changed: false };
  markNumberProvisionSkipped(tenant, NEEDS_MANUAL_RECONCILE_REASON);
  return { tenant, changed: true };
}

export function requestNumber(
  state: MandantUndNummern,
  {
    tenantId,
    provider = DEFAULT_PROVIDER,
    country = DEFAULT_COUNTRY,
    language = languageForCountry(country),
    maxNumbers,
    maxNumbersPerTenant,
  }: {
    tenantId: string;
    provider?: string;
    country?: string | undefined;
    language?: string | null;
    maxNumbers: number;
    maxNumbersPerTenant: number;
  },
): { ok: false; reason: string } | { ok: true; number: Nummernsatz } {
  const tenant = findTenant(state, tenantId);
  if (!tenant || !tenantMayRequestNumber(state, tenantId))
    return { ok: false, reason: REQUEST_NUMBER_REASON.TENANT_INACTIVE };
  if (liveNumbers(state).length >= maxNumbers) {
    markNumberProvisionSkipped(tenant, GLOBAL_CAP_REASON);
    return { ok: false, reason: GLOBAL_CAP_REASON };
  }
  if (liveNumbers(state, tenantId).length >= maxNumbersPerTenant)
    return { ok: false, reason: REQUEST_NUMBER_REASON.TENANT_CAP };
  const number: Nummernsatz = {
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

function findSwapTrace(state: MitJobs, oldNumberId: string): Bereitstellung | undefined {
  return state.provisioningJobs.find(
    (job) => job.kind === NUMBER_SWAP_JOB && job.idempotencyKey === swapKey(oldNumberId),
  );
}

function replacementNumberFor(state: MitJobs & MitNummern, oldNumberId: string): Nummernsatz | null {
  const trace = findSwapTrace(state, oldNumberId);
  return trace ? findNumber(state, trace.numberId) : null;
}

function hasActiveBuyableNumber(state: MitNummern, tenantId: string): boolean {
  return state.numbers.some(
    (number) =>
      number.tenantId === tenantId &&
      number.status === NUMBER_STATUS.ACTIVE &&
      hatKaufbareVorwahl(number.e164),
  );
}

function isPlatformNumber(state: MitNummern & MitBindungen, number: Nummernsatz): boolean {
  if (number.tenantId === BOOTSTRAP_TENANT_ID) return true;
  return platformNumberBindings(state, number.e164).length > 0;
}

function isSwapCandidate(state: MandantUndNummern & MitJobs & MitBindungen, number: Nummernsatz): boolean {
  if (number.status !== NUMBER_STATUS.ACTIVE || !number.e164 || !number.providerNumberId) return false;
  if (hatKaufbareVorwahl(number.e164) || isPlatformNumber(state, number)) return false;
  if (!tenantMayRequestNumber(state, number.tenantId)) return false;
  return replacementNumberFor(state, number.id) !== null || !hasActiveBuyableNumber(state, number.tenantId);
}

export function nummerntauschKandidaten(state: MandantUndNummern & MitJobs & MitBindungen): Nummernsatz[] {
  return state.numbers.filter((number) => isSwapCandidate(state, number));
}

const IN_SERVICE = new Set<string>([NUMBER_STATUS.ACTIVE, NUMBER_STATUS.SUSPENDED]);

function capReached(state: MitNummern, maxNumbers: number, ownNumber: Nummernsatz | null = null): boolean {
  return liveNumbers(state).filter((number) => number !== ownNumber).length >= maxNumbers;
}

function openReplacement(state: MitNummern & MitJobs, old: Nummernsatz, maxNumbers: number): Tauschergebnis {
  if (capReached(state, maxNumbers)) return { ergebnis: { ok: false, grund: TAUSCH_ERGEBNIS.PLATTFORMDECKE } };
  const number: Nummernsatz = {
    id: newId("num"),
    e164: null,
    tenantId: old.tenantId,
    provider: old.provider ?? DEFAULT_PROVIDER,
    country: kauflandFuer(old.country),
    language: old.language ?? languageForCountry(old.country),
    status: NUMBER_STATUS.REQUESTED,
    providerNumberId: null,
    paymentIntentId: null,
  };
  state.numbers.push(number);
  state.provisioningJobs.push({
    id: newId("job"),
    numberId: number.id,
    tenantId: old.tenantId,
    kind: NUMBER_SWAP_JOB,
    status: PROVISIONING_JOB_STATUS.DONE,
    idempotencyKey: swapKey(old.id),
    attempts: 1,
    lastError: null,
    createdAt: new Date().toISOString(),
  });
  return { ergebnis: { ok: true, number, purchase: true }, geaendert: true };
}

function kaufBestaetigt(number: Nummernsatz): boolean {
  return number.status === NUMBER_STATUS.PROVISIONING && Boolean(number.e164);
}

function resumeReplacement(
  state: MitNummern & MitJobs,
  trace: Bereitstellung,
  maxNumbers: number,
): Tauschergebnis {
  const number = findNumber(state, trace.numberId);
  if (number && IN_SERVICE.has(number.status)) return { ergebnis: { ok: true, number, purchase: false } };
  if (!number || number.status === NUMBER_STATUS.RELEASED || trace.attempts >= SWAP_ATTEMPTS_MAX || kaufBestaetigt(number))
    return { ergebnis: { ok: false, grund: TAUSCH_ERGEBNIS.MANUELL } };
  if (capReached(state, maxNumbers, number))
    return { ergebnis: { ok: false, grund: TAUSCH_ERGEBNIS.PLATTFORMDECKE } };
  number.status = NUMBER_STATUS.REQUESTED;
  Object.assign(trace, { attempts: trace.attempts + 1 });
  return { ergebnis: { ok: true, number, purchase: true }, geaendert: true };
}

export function ersatzNummerAnfordern(
  state: MitNummern & MitJobs,
  { oldNumberId, maxNumbers }: { oldNumberId: string; maxNumbers: number },
): Tauschergebnis {
  const old = findNumber(state, oldNumberId);
  if (!old) throw new Error(`ersatzNummerAnfordern: Nummer ${oldNumberId} nicht gefunden`);
  const trace = findSwapTrace(state, oldNumberId);
  return trace ? resumeReplacement(state, trace, maxNumbers) : openReplacement(state, old, maxNumbers);
}

const CALL_STATUS_ACTIVE = "active";

function isOpenBinding(binding: PlattformBindung): boolean {
  return binding.releasedAt === null;
}

function findOpenBinding(state: MitBindungen, e164: string, purpose: string): PlattformBindung | undefined {
  return state.platformNumberUse.find(
    (binding) => binding.e164 === e164 && binding.purpose === purpose && isOpenBinding(binding),
  );
}

function closingTimestamp(): string {
  return new Date().toISOString();
}

export function platformNumberBindings(state: MitBindungen, e164: Kennung): PlattformBindung[] {
  if (!e164) return [];
  return state.platformNumberUse.filter((binding) => binding.e164 === e164 && isOpenBinding(binding));
}

export function openPlatformBindingByPurpose(state: MitBindungen, purpose: string): PlattformBindung | undefined {
  return state.platformNumberUse.find((binding) => binding.purpose === purpose && isOpenBinding(binding));
}

function bindingBelongsTo(binding: PlattformBindung, tenantId: string): boolean {
  return binding.tenantId === tenantId;
}

export function activeCallOnNumber(state: MitAnrufen, e164: Kennung): boolean {
  return (
    Boolean(e164) &&
    state.calls.some((call) => call.status === CALL_STATUS_ACTIVE && (call.from === e164 || call.to === e164))
  );
}

export function numberBusyReason(
  state: MitBindungen & MitAnrufen,
  number: Nummernsatz,
  { forTenantId = null }: { forTenantId?: string | null } = {},
): string | null {
  const bindings = platformNumberBindings(state, number.e164);
  const blockedByForeignBinding = bindings.some(
    (binding) => forTenantId === null || !bindingBelongsTo(binding, forTenantId),
  );
  if (blockedByForeignBinding) return NUMBER_HOLD_REASON.PLATFORM_IN_USE;
  if (activeCallOnNumber(state, number.e164)) return NUMBER_HOLD_REASON.ACTIVE_CALL;
  return null;
}

export function bindPlatformNumber(
  state: MitBindungen,
  {
    e164,
    purpose,
    provider,
    tenantId = null,
    providerNumberId = null,
    note = null,
  }: {
    e164: string;
    purpose: string;
    provider: string;
    tenantId?: string | null;
    providerNumberId?: string | null;
    note?: string | null;
  },
): PlattformBindung {
  const open = findOpenBinding(state, e164, purpose);
  if (open) return open;
  const binding = {
    id: newId("pnu"), e164, purpose, provider, tenantId, providerNumberId,
    boundAt: new Date().toISOString(), releasedAt: null, note,
  };
  state.platformNumberUse.push(binding);
  return binding;
}

export function unbindPlatformNumber(
  state: MitBindungen,
  { e164, purpose }: { e164: string; purpose: string },
): PlattformBindung | null {
  const open = findOpenBinding(state, e164, purpose);
  if (!open) return null;
  open.releasedAt = closingTimestamp();
  return open;
}

export function unbindOwnPlatformBindings(state: MitBindungen, number: Nummernsatz): PlattformBindung[] {
  if (!number.e164) return [];
  const closed: PlattformBindung[] = [];
  for (const binding of platformNumberBindings(state, number.e164)) {
    if (!bindingBelongsTo(binding, number.tenantId)) continue;
    binding.releasedAt = closingTimestamp();
    closed.push(binding);
  }
  return closed;
}

export function syncPlatformBindings(
  state: MitBindungen,
  desired: {
    purpose: string;
    e164: string | null;
    provider: string;
    tenantId?: string | null;
    note?: string | null;
  }[],
): PlattformBindung[] {
  for (const { purpose, e164, provider, tenantId = null, note = null } of desired) {
    for (const binding of state.platformNumberUse)
      if (binding.purpose === purpose && isOpenBinding(binding) && binding.e164 !== e164)
        binding.releasedAt = closingTimestamp();
    if (e164) bindPlatformNumber(state, { e164, purpose, provider, tenantId, note });
  }
  return state.platformNumberUse.filter(isOpenBinding);
}

export function openOutageAlert(state: MitMarken, code: string): Ausfallmarke | undefined {
  return state.outageAlerts.find((alert) => alert.code === code && alert.closedAt === null);
}

export function claimOutageAlert(
  state: MitMarken,
  { code, nowMs, sent = false, channels = [] }: { code: string; nowMs: number; sent?: boolean; channels?: string[] },
): Ausfallmarke {
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

export function closeOutageAlert(
  state: MitMarken,
  { code, nowMs }: { code: string; nowMs: number },
): Ausfallmarke | null {
  const marker = openOutageAlert(state, code);
  if (!marker) return null;
  marker.closedAt = new Date(nowMs).toISOString();
  return marker;
}

const NUMBER_OUT_OF_SERVICE = new Set<string>([NUMBER_STATUS.RELEASED, NUMBER_STATUS.SUSPENDED]);

export function transitionNumber(state: Uebergang, numberId: string, toStatus: string): Nummernsatz {
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

export function beginProvisioning(state: Uebergang, numberId: string): Nummernsatz {
  return transitionNumber(state, numberId, NUMBER_STATUS.PROVISIONING);
}

export function attachNumberPaymentIntent(
  state: MitNummern,
  numberId: string,
  paymentIntentId: string | null,
): Nummernsatz {
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`attachNumberPaymentIntent: Nummer ${numberId} nicht gefunden`);
  number.paymentIntentId = paymentIntentId;
  return number;
}

export function attachNumberRegistration(
  state: MitNummern,
  numberId: string,
  providerAgentPhoneNumberId: string | null,
): Nummernsatz {
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`attachNumberRegistration: Nummer ${numberId} nicht gefunden`);
  if (number.providerAgentPhoneNumberId) return number;
  number.providerAgentPhoneNumberId = providerAgentPhoneNumberId;
  return number;
}

const INBOUND_TRUNK_BELEG_FELDER: readonly ("elInboundTrunkBelegtAt" | "elInboundTrunkZugangFp")[] = Object.freeze([
  "elInboundTrunkBelegtAt",
  "elInboundTrunkZugangFp",
]);

function hatInboundTrunkBeleg(number: Nummernsatz): boolean {
  return INBOUND_TRUNK_BELEG_FELDER.some((feld) => number[feld] !== undefined && number[feld] !== null);
}

export function markNumberElInboundTrunkBelegt(
  state: MitNummern,
  numberId: string,
  { nowIso, zugangFp }: { nowIso: string; zugangFp: string },
): { number: Nummernsatz | null; changed: boolean } {
  if (!nowIso || !zugangFp) throw new Error("markNumberElInboundTrunkBelegt: nowIso und zugangFp sind Pflicht");
  const number = findNumber(state, numberId);
  if (number?.status !== NUMBER_STATUS.ACTIVE) return { number, changed: false };
  if (number.elInboundTrunkZugangFp === zugangFp && number.elInboundTrunkBelegtAt) return { number, changed: false };
  number.elInboundTrunkBelegtAt = nowIso;
  number.elInboundTrunkZugangFp = zugangFp;
  return { number, changed: true };
}

export function clearNumberElInboundTrunkBeleg(
  state: MitNummern,
  numberId: string,
): { number: Nummernsatz | null; changed: boolean } {
  const number = findNumber(state, numberId);
  if (!number || !hatInboundTrunkBeleg(number)) return { number, changed: false };
  delete number.elInboundTrunkBelegtAt;
  delete number.elInboundTrunkZugangFp;
  return { number, changed: true };
}

export function beginCapturing(state: Uebergang, numberId: string): Nummernsatz {
  return transitionNumber(state, numberId, NUMBER_STATUS.CAPTURING);
}

export function activateNumber(
  state: Uebergang & MitZuweisungen,
  numberId: string,
  {
    e164,
    providerNumberId,
    monthlyCostCents = null,
  }: { e164: string; providerNumberId?: string | null; monthlyCostCents?: number | null },
): Nummernsatz {
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

export function failNumber(state: Uebergang, numberId: string): Nummernsatz {
  return transitionNumber(state, numberId, NUMBER_STATUS.FAILED);
}

export function markNumberGekauft(state: MitNummern, numberId: string, e164: string): Nummernsatz {
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`markNumberGekauft: Nummer ${numberId} nicht gefunden`);
  number.e164 = e164;
  return number;
}

export function releaseNumber(state: Uebergang & MitZuweisungen, numberId: string): Nummernsatz {
  const number = transitionNumber(state, numberId, NUMBER_STATUS.RELEASED);
  number.e164 = null;
  number.providerAgentPhoneNumberId = null;
  delete number.elInboundTrunkBelegtAt;
  delete number.elInboundTrunkZugangFp;
  const asg = state.numberAssignments.find(
    (assignment) => assignment.numberId === numberId && !assignment.releasedAt,
  );
  if (asg) asg.releasedAt = new Date().toISOString();
  return number;
}

export function recordProvisioningJob(
  state: MitJobs,
  { numberId, tenantId, idempotencyKey }: { numberId: string; tenantId: string; idempotencyKey: string },
): Bereitstellung {
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

const PROVISION_CLOSE_NUMBER_STATUS = new Set<string>([
  NUMBER_STATUS.ACTIVE,
  NUMBER_STATUS.FAILED,
  NUMBER_STATUS.RELEASED,
  NUMBER_STATUS.SUSPENDED,
]);

export function redriveAgeHoldReason(
  job: { createdAt?: string | null },
  nowMs: number,
  maxAgeMs: number,
): string | null {
  const createdMs = Date.parse(job.createdAt ?? "");
  if (!job.createdAt || Number.isNaN(createdMs)) return "unknown_age";
  if (nowMs - createdMs > maxAgeMs) return "too_old";
  return null;
}

export function classifyQueuedProvisioningJobs(
  state: MandantUndNummern & MitJobs,
  { nowMs, maxAgeMs, kycMinLevel }: { nowMs: number; maxAgeMs: number; kycMinLevel: KycStufe },
): { close: Bereitstellung[]; hold: { job: Bereitstellung; reason: string }[]; redrive: Bereitstellung[] } {
  const buckets: {
    close: Bereitstellung[];
    hold: { job: Bereitstellung; reason: string }[];
    redrive: Bereitstellung[];
  } = { close: [], hold: [], redrive: [] };
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

export function numberReleaseVerdict(
  state: MandantUndNummern & MitBindungen & MitAnrufen,
  number: Nummernsatz,
  { nowMs, graceMs }: { nowMs: number; graceMs: number },
): { action: string; reason: string | null } {
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

export function classifyNumbersForRelease(
  state: MandantUndNummern & MitBindungen & MitAnrufen,
  { nowMs, graceMs }: { nowMs: number; graceMs: number },
): {
  release: Nummernsatz[];
  hold: { number: Nummernsatz; reason: string | null }[];
  skip: { number: Nummernsatz; reason: string | null }[];
} {
  const buckets: {
    release: Nummernsatz[];
    hold: { number: Nummernsatz; reason: string | null }[];
    skip: { number: Nummernsatz; reason: string | null }[];
  } = { release: [], hold: [], skip: [] };
  for (const number of state.numbers) {
    const { action, reason } = numberReleaseVerdict(state, number, { nowMs, graceMs });
    if (action === RELEASE_VERDICT.RELEASE) buckets.release.push(number);
    else if (action === RELEASE_VERDICT.HOLD) buckets.hold.push({ number, reason });
    else buckets.skip.push({ number, reason });
  }
  return buckets;
}

export function tenantNumbersForErase(
  state: MandantUndNummern & MitBindungen & MitAnrufen,
  tenantId: string,
): { release: Nummernsatz[]; hold: { number: Nummernsatz; reason: string }[] } {
  const buckets: { release: Nummernsatz[]; hold: { number: Nummernsatz; reason: string }[] } = {
    release: [],
    hold: [],
  };
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
  state: MandantZustand,
  tenantId: string,
  { numberReleasePending, workosDeletePending }: { numberReleasePending?: boolean; workosDeletePending?: boolean } = {},
): Mandant | null {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return null;
  if (numberReleasePending !== undefined) tenant.numberReleasePending = numberReleasePending;
  if (workosDeletePending !== undefined) tenant.workosDeletePending = workosDeletePending;
  return tenant;
}

export function contractEndCleanupPending(
  state: MandantZustand,
  tenantId: string,
): { numberReleasePending: boolean; workosDeletePending: boolean } {
  const tenant = findTenant(state, tenantId);
  return {
    numberReleasePending: tenant?.numberReleasePending ?? false,
    workosDeletePending: tenant?.workosDeletePending ?? false,
  };
}

export function tenantsPendingContractEndCleanup(state: MandantZustand): Mandant[] {
  return tenantsOf(state).filter(
    (tenant) => Boolean(tenant.numberReleasePending) || Boolean(tenant.workosDeletePending),
  );
}

export function platformHoldEscalationCandidates(
  state: MandantUndNummern & MitBindungen & MitAnrufen,
  { nowMs, maxAgeMs }: { nowMs: number; maxAgeMs: number },
): Nummernsatz[] {
  const candidates: Nummernsatz[] = [];
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

export function paidWithoutNumberCandidates(
  state: MandantUndNummern,
  { nowMs, graceMs, kycMinLevel }: { nowMs: number; graceMs: number; kycMinLevel: KycStufe },
): { tenantId: string; paidSinceIso: string }[] {
  const candidates: { tenantId: string; paidSinceIso: string }[] = [];
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

export function registrierungAnhaengen(
  zustand: MitNummern,
  numberId: string,
  providerAgentPhoneNumberId: string | null,
): { ergebnis: Nummernsatz; geaendert: boolean } {
  const number = attachNumberRegistration(zustand, numberId, providerAgentPhoneNumberId);
  return { ergebnis: number, geaendert: number.providerAgentPhoneNumberId === providerAgentPhoneNumberId };
}

export function bootstrapNummerAnlegen(
  state: MitNummern,
  e164: string,
  {
    tenantId,
    provider = DEFAULT_PROVIDER,
    country = DEFAULT_COUNTRY,
    language = languageForCountry(country),
  }: { tenantId: string; provider?: string; country?: string; language?: string },
): void {
  const norm = normNum(e164);
  if (!norm) return;
  if (state.numbers.some((number) => number.e164 === norm)) return;
  state.numbers.push({
    id: newId("num"),
    e164: norm,
    tenantId,
    provider,
    country,
    language,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: null,
  });
}

export function bootstrapNummerAusKonfigAnlegen(
  state: MitNummern,
  e164: string,
  { tenantId, provider }: { tenantId: string; provider: string },
): void {
  if (!Object.values<string>(PROVIDER).includes(provider)) return;
  bootstrapNummerAnlegen(state, e164, { tenantId, provider });
}

export function provisioningJobMarkieren(
  state: MitJobs,
  jobId: string,
  { status, lastError = null }: { status: string; lastError?: string | null },
): Bereitstellung | null {
  const job = state.provisioningJobs.find((candidate) => candidate.id === jobId);
  if (!job) return null;
  job.status = status;
  job.attempts += 1;
  if (lastError) job.lastError = lastError;
  return job;
}

export function numbersDueForMonthMeter(
  state: MitNummern & MitJobs & MitNutzung,
  { nowIso, tenantId = null }: { nowIso: string; tenantId?: string | null },
): Nummernsatz[] {
  const monthKey = spendMonthKeyOf(nowIso);
  if (!monthKey) return [];
  const ersatzZuAlt = ersatzZuAlterNummer(state);
  const platzOf = (numberId: string): string => ersatzZuAlt.get(numberId) ?? numberId;
  const gebucht = new Set<string>();
  for (const usageEvent of state.usageEvents) {
    if (usageEvent.kind !== USAGE_EVENT_KIND.NUMBER_MONTH) continue;
    if (!usageEvent.numberId) continue;
    if (spendMonthKeyOf(usageEvent.occurredAt) !== monthKey) continue;
    gebucht.add(platzOf(usageEvent.numberId));
  }
  const aktiv = state.numbers.filter((number) => number.status === NUMBER_STATUS.ACTIVE);
  const ersetzteMitAktivemErsatz = new Set(
    aktiv.filter((number) => ersatzZuAlt.has(number.id)).map((number) => ersatzZuAlt.get(number.id)),
  );
  return aktiv.filter(
    (number) =>
      (tenantId === null || number.tenantId === tenantId) &&
      !gebucht.has(platzOf(number.id)) &&
      !ersetzteMitAktivemErsatz.has(number.id),
  );
}
