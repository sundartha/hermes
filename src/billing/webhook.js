import crypto from "node:crypto";
import { z } from "zod";
import { activatePaidTenant, profileAuditDetail } from "./activation.js";
import { provisionAuditDetail } from "./provision-outcome.ts";
import { bindPaymentMethodOnTenant, customerMatches } from "./card-setup.ts";
import { enumOrNull } from "./provider-enum.ts";
import { hasCardOnFile } from "../self-service.js";
import { makeKeyedChainMutex } from "../chain-mutex.js";
import { isKnownPlanSlug } from "../plans.js";
import { moneyActionFor, graceDueAtIso, MONEY_ACTION, MONEY_EVENT } from "./money-events.ts";
import { attemptContractEndCleanup } from "./contract-end-cleanup.js";
import { clearSubscriptionReference } from "./subscribe.js";

const SIGNATURE_TOLERANCE_S = 300;

const NICHT_LEERER_TEXT = z.string().min(1);
const ZWEI_TEXTE = z.tuple([z.string(), z.string()]);
const TEXT = z.string();
const OBJEKT = z.object({}).passthrough();
const FUNKTION = z.instanceof(Function);

export const SUBSCRIPTION_EVENT = Object.freeze({
  CREATED: "customer.subscription.created",
  UPDATED: "customer.subscription.updated",
  DELETED: "customer.subscription.deleted",
  PAYMENT_FAILED: "invoice.payment_failed",
});

export const WEBHOOK_ACTION = Object.freeze({
  ACTIVATE: "activate",
  SUSPEND: "suspend",
  IGNORE: "ignore",
  MONEY: "money_event",
  CANCEL_SCHEDULED: "cancel_scheduled",
});

const ACTIVATION_PENDING_ALARM_SMS_PREFIX = "[Hermes] Aktivierung wartet auf Provisioning: ";
const SUBSCRIPTION_CONFLICT_ALARM_SMS_PREFIX = "[Hermes] Abweichendes Abo: ";
const MONEY_EVENT_ALARM_SMS_PREFIX = "[Hermes] Zahlungsereignis: ";

const CONFIRMED_SUBSCRIPTION_STATUS = Object.freeze(new Set(["active", "trialing"]));

export const SUSPEND_REASON = Object.freeze({
  SUBSCRIPTION_DELETED: "subscription_deleted",
  PAYMENT_FAILED: "payment_failed",
});

const WEBHOOK_IGNORE_REASON = Object.freeze({
  NO_TENANT: "no_tenant",
  UNKNOWN_TENANT: "unknown_tenant",
});

function parseSignatureHeader(header) {
  if (!NICHT_LEERER_TEXT.safeParse(header).success) return null;
  let timestamp = null;
  const v1 = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "t") timestamp = value;
    else if (key === "v1") v1.push(value);
  }
  if (!timestamp || v1.length === 0) return null;
  return { timestamp, v1 };
}

function safeHexEqual(a, b) {
  if (!ZWEI_TEXTE.safeParse([a, b]).success || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function verifyStripeSignature({ rawBody, signatureHeader, secret, nowS }) {
  if (!secret || rawBody == null) return false;
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const timestampS = Number(parsed.timestamp);
  if (!Number.isFinite(timestampS)) return false;
  if (Math.abs(nowS - timestampS) > SIGNATURE_TOLERANCE_S) return false;
  const payload = `${parsed.timestamp}.${Buffer.from(rawBody).toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return parsed.v1.some((candidate) => safeHexEqual(candidate, expected));
}

function ignoredEvent() {
  return { action: WEBHOOK_ACTION.IGNORE, tenantRef: null, subscriptionId: null };
}

function interpretSubscriptionChange(object) {
  if (!CONFIRMED_SUBSCRIPTION_STATUS.has(object.status)) return ignoredEvent();
  const period = periodFieldsOf(object);
  const shared = {
    tenantRef: tenantRefOf(object),
    subscriptionId: object.id ?? null,
    planSlug: planSlugOf(object),
    currentPeriodEnd: period.currentPeriodEnd ?? null,
    currentPeriodStart: period.currentPeriodStart ?? null,
    customerId: object.customer ?? null,
    paymentMethodId: paymentMethodIdOf(object.default_payment_method),
    paymentMethodType: paymentMethodTypeOf(object.default_payment_method),
  };
  if (object.cancel_at_period_end === true) {
    return { action: WEBHOOK_ACTION.CANCEL_SCHEDULED, ...shared, cancelAtPeriodEnd: true };
  }
  return {
    action: WEBHOOK_ACTION.ACTIVATE,
    ...shared,
    ...(object.cancel_at_period_end === false ? { cancelAtPeriodEnd: false } : {}),
  };
}

function interpretSubscriptionDeleted(object) {
  return {
    action: WEBHOOK_ACTION.SUSPEND,
    suspendReason: SUSPEND_REASON.SUBSCRIPTION_DELETED,
    tenantRef: tenantRefOf(object),
    subscriptionId: object.id ?? null,
  };
}

function interpretPaymentFailed(object) {
  return {
    action: WEBHOOK_ACTION.SUSPEND,
    suspendReason: SUSPEND_REASON.PAYMENT_FAILED,
    tenantRef: tenantRefOf(object),
    subscriptionId: object.subscription ?? null,
  };
}

function interpretMoneyEvent(type, object) {
  const money = moneyActionFor(type, object);
  if (!money) return ignoredEvent();
  return {
    action: WEBHOOK_ACTION.MONEY,
    tenantRef: tenantRefOf(object),
    subscriptionId: moneyEventSubscriptionId(type, object),
    customerId: object.customer ?? null,
    moneyAction: money.action,
    moneyAlarm: money.alarm,
  };
}

export function interpretStripeEvent(event) {
  const object = (event && event.data && event.data.object) || {};
  const type = event && event.type;
  switch (type) {
    case SUBSCRIPTION_EVENT.CREATED:
    case SUBSCRIPTION_EVENT.UPDATED:
      return interpretSubscriptionChange(object);
    case SUBSCRIPTION_EVENT.DELETED:
      return interpretSubscriptionDeleted(object);
    case SUBSCRIPTION_EVENT.PAYMENT_FAILED:
      return interpretPaymentFailed(object);
    default:
      return interpretMoneyEvent(type, object);
  }
}

function moneyEventSubscriptionId(type, object) {
  if (type === MONEY_EVENT.SUBSCRIPTION_PAUSED) return object.id ?? null;
  if (type === MONEY_EVENT.PAYMENT_ACTION_REQUIRED) return object.subscription ?? null;
  return null;
}

export function paymentMethodIdOf(defaultPaymentMethod) {
  const text = TEXT.safeParse(defaultPaymentMethod);
  if (text.success) return text.data;
  return (defaultPaymentMethod && defaultPaymentMethod.id) || null;
}

export function paymentMethodTypeOf(defaultPaymentMethod) {
  if (!OBJEKT.safeParse(defaultPaymentMethod).success) return null;
  return enumOrNull(defaultPaymentMethod.type);
}

export function periodFieldsOf(subLike) {
  const item = subLike.items && subLike.items.data && subLike.items.data[0];
  return {
    currentPeriodStart: (item && item.current_period_start) ?? subLike.current_period_start,
    currentPeriodEnd: (item && item.current_period_end) ?? subLike.current_period_end,
  };
}

function tenantRefOf(object) {
  return (object.metadata && object.metadata.tenant_ref) || null;
}

function planSlugOf(object) {
  return (object.metadata && object.metadata.plan_slug) || null;
}

function clearEndedSubscriptionRefAndAudit({ store, tenant, suspendReason, audit, req }) {
  const subscriptionEnded = suspendReason === SUSPEND_REASON.SUBSCRIPTION_DELETED;
  if (subscriptionEnded) clearSubscriptionReference(store, tenant);
  audit(
    "stripe_webhook_suspend",
    req,
    `tenant=${tenant} reason=${suspendReason} subscription_ref=${subscriptionEnded ? "cleared" : "kept"}`,
  );
}

function resolveExistingTenant(store, tenantRef, findFallbackTenantId) {
  if (!tenantRef) {
    const tenant = findFallbackTenantId();
    return tenant
      ? { tenant, reason: null }
      : { tenant: null, reason: WEBHOOK_IGNORE_REASON.NO_TENANT };
  }
  if (!store.tenantExists(tenantRef))
    return { tenant: null, reason: WEBHOOK_IGNORE_REASON.UNKNOWN_TENANT };
  return { tenant: tenantRef, reason: null };
}

function unresolvedTenantDetail(reason, tenantRef) {
  if (reason === WEBHOOK_IGNORE_REASON.UNKNOWN_TENANT) return `tenant=${tenantRef} ${reason}`;
  return reason;
}

async function resolvePaymentMethodType({ billing, paymentMethodType, paymentMethodId }) {
  if (paymentMethodType) return paymentMethodType;
  if (!billing) return null;
  try {
    return await billing.retrievePaymentMethodType(paymentMethodId);
  } catch {
    return null;
  }
}

async function bindPaymentMethodFromEventIfMissing({
  store,
  billing,
  tenant,
  event: { customerId, paymentMethodId, paymentMethodType },
}) {
  if (!customerId || !paymentMethodId) return;
  if (hasCardOnFile(store.tenantStripe(tenant))) return;
  if (!customerMatches(store, tenant, customerId)) return;
  const typ = await resolvePaymentMethodType({ billing, paymentMethodType, paymentMethodId });
  bindPaymentMethodOnTenant(store, tenant, { paymentMethodId, paymentMethodType: typ });
}

function foreignStoredSubscription(store, tenant, subscriptionId) {
  const stored = store.tenantSubscription(tenant).subscriptionId;
  if (!stored || subscriptionId == null || tenantHoldsSubscription(store, tenant, subscriptionId)) return null;
  return stored;
}

function rejectForeignSubscription({ store, tenant, action, subscriptionId, audit, req }) {
  if (!CANCEL_STATE_ACTIONS.has(action)) return null;
  const stored = foreignStoredSubscription(store, tenant, subscriptionId);
  if (!stored) return null;
  audit("stripe_webhook_subscription_conflict", req, `tenant=${tenant} stored=${stored} event=${subscriptionId}`);
  return {
    alarm: {
      prefix: SUBSCRIPTION_CONFLICT_ALARM_SMS_PREFIX,
      detail: `tenant=${tenant} gespeichert=${stored} ereignis=${subscriptionId}`,
    },
  };
}

function rejectNotHeldSuspend({ store, tenant, subscriptionId, audit, req }) {
  if (!foreignStoredSubscription(store, tenant, subscriptionId)) return false;
  audit("stripe_webhook_ignored", req, `action=${WEBHOOK_ACTION.SUSPEND} tenant=${tenant} reason=not_held_subscription`);
  return true;
}

export async function applyStripeWebhook(
  event,
  {
    store,
    accounts,
    sessions,
    audit,
    req,
    provision,
    billing,
    numberProvisioner,
    workos,
    auditStore = { record: async () => {} },
    sipRegistrar,
  },
) {
  const interpreted = interpretStripeEvent(event);
  const {
    action, tenantRef, subscriptionId, planSlug, currentPeriodEnd, currentPeriodStart,
    customerId, paymentMethodId, paymentMethodType, cancelAtPeriodEnd, suspendReason,
  } = interpreted;
  if (action === WEBHOOK_ACTION.IGNORE) return;
  if (action === WEBHOOK_ACTION.MONEY) return applyMoneyEvent(event, interpreted, { store, audit, req });
  const bySubscription = () => store.findTenantBySubscription(subscriptionId)?.id || null;
  const { tenant, reason: unresolved } = resolveExistingTenant(store, tenantRef, bySubscription);
  if (!tenant) {
    audit("stripe_webhook_ignored", req, `action=${action} ${unresolvedTenantDetail(unresolved, tenantRef)}`);
    return;
  }
  const conflict = rejectForeignSubscription({ store, tenant, action, subscriptionId, audit, req });
  if (conflict) return conflict;
  if (action === WEBHOOK_ACTION.CANCEL_SCHEDULED) {
    if (planSlug != null && !isKnownPlanSlug(planSlug)) {
      audit("stripe_webhook_ignored", req, `action=${action} tenant=${tenant} unknown_plan`);
      return;
    }
    const patch = { cancelAtPeriodEnd: true };
    if (subscriptionId != null) patch.subscriptionId = subscriptionId;
    if (planSlug != null) patch.planSlug = planSlug;
    if (currentPeriodEnd != null) patch.currentPeriodEnd = currentPeriodEnd;
    if (currentPeriodStart != null) patch.currentPeriodStart = currentPeriodStart;
    store.setTenantSubscription(tenant, patch);
    audit(
      "stripe_webhook_cancel_scheduled",
      req,
      `tenant=${tenant} current_period_end=${currentPeriodEnd ?? "unknown"}`,
    );
    return { cancelScheduled: true };
  }
  if (action === WEBHOOK_ACTION.ACTIVATE) {
    if (planSlug != null && !isKnownPlanSlug(planSlug)) {
      audit("stripe_webhook_ignored", req, `action=${action} tenant=${tenant} unknown_plan`);
      return;
    }
    const patch = {};
    if (subscriptionId != null) patch.subscriptionId = subscriptionId;
    if (planSlug != null) patch.planSlug = planSlug;
    if (currentPeriodEnd != null) patch.currentPeriodEnd = currentPeriodEnd;
    if (currentPeriodStart != null) patch.currentPeriodStart = currentPeriodStart;
    if (cancelAtPeriodEnd != null) patch.cancelAtPeriodEnd = cancelAtPeriodEnd;
    store.setTenantSubscription(tenant, patch);
    await bindPaymentMethodFromEventIfMissing({
      store,
      billing,
      tenant,
      event: { customerId, paymentMethodId, paymentMethodType },
    });
    const { profile, activated, provisioned, budgetPeriodStarted } = await activatePaidTenant({
      store, accounts, provision, billing, tenant,
    });
    audit(
      "stripe_webhook_activate",
      req,
      `tenant=${tenant} ${profileAuditDetail(profile)} ${provisionAuditDetail(provisioned)} budget_period=${budgetPeriodStarted ? "reset" : "kept"}`,
    );
    if (activated) return { activated: true };
    return {
      activated: false,
      alarm: {
        prefix: ACTIVATION_PENDING_ALARM_SMS_PREFIX,
        detail: `tenant=${tenant} ${provisionAuditDetail(provisioned)}`,
      },
    };
  }
  if (rejectNotHeldSuspend({ store, tenant, subscriptionId, audit, req })) return;
  const endedViaCancellation = store.tenantSubscription(tenant).cancelAtPeriodEnd;
  await accounts.setStatus(tenant, "suspended");
  await store.setSuspendedAtIfAbsent(tenant);
  await sessions.invalidateByTenant(tenant);
  clearEndedSubscriptionRefAndAudit({ store, tenant, suspendReason, audit, req });
  if (endedViaCancellation) {
    try {
      await attemptContractEndCleanup({ store, numberProvisioner, workos, auditStore, tenantId: tenant, sipRegistrar });
    } catch (e) {
      console.error(`[contract-end] Aufraeumen fehlgeschlagen tenant=${tenant}: ${e.message}`);
    }
  }
  return { suspended: true };
}

async function applyMoneyEvent(event, interpreted, { store, audit, req }) {
  const { tenantRef, customerId, moneyAction, moneyAlarm } = interpreted;
  const eventType = event && event.type;
  const eventId = (event && event.id) ?? "unknown";
  audit("stripe_money_event", req, `type=${eventType} event=${eventId} action=${moneyAction}`);
  const { tenant, reason: unresolved } = resolveExistingTenant(
    store,
    tenantRef,
    () => (customerId && store.findTenantByCustomer(customerId)?.id) || null,
  );
  if (!tenant) {
    audit(
      "stripe_money_event_ignored",
      req,
      `type=${eventType} event=${eventId} ${unresolvedTenantDetail(unresolved, tenantRef)}`,
    );
    return { action: WEBHOOK_ACTION.MONEY, tenant: null, alarm: null };
  }
  await applyMoneyAction(store, tenant, moneyAction);
  return {
    action: WEBHOOK_ACTION.MONEY,
    tenant,
    alarm: moneyAlarm
      ? { prefix: MONEY_EVENT_ALARM_SMS_PREFIX, detail: `type=${eventType} tenant=${tenant}` }
      : null,
  };
}

async function applyMoneyAction(store, tenant, moneyAction) {
  switch (moneyAction) {
    case MONEY_ACTION.WARN:
      return;
    case MONEY_ACTION.REVOKE_PERIOD_CREDIT:
      store.setTenantSubscription(tenant, { periodCreditRevoked: true });
      return;
    case MONEY_ACTION.HOLD_OUTBOUND:
      await store.setBillingHold(tenant, { reason: "paused" });
      return;
    case MONEY_ACTION.GRACE_THEN_HOLD:
      await store.setBillingHold(tenant, {
        reason: "payment_action",
        dueAtIso: graceDueAtIso(new Date().toISOString()),
      });
      return;
    default:
      return;
  }
}

const webhookLock = makeKeyedChainMutex();

const lastAppliedByStore = new WeakMap();

function lastAppliedOf(store) {
  if (!lastAppliedByStore.has(store)) lastAppliedByStore.set(store, new Map());
  return lastAppliedByStore.get(store);
}

function eventAnchorOf(event, action) {
  return { eventId: event.id ?? null, createdAt: Number(event.created), action };
}

function isStaleEvent(lastApplied, candidate) {
  if (!lastApplied) return false;
  if (candidate.eventId != null && candidate.eventId === lastApplied.eventId) return true;
  if (!Number.isFinite(lastApplied.createdAt)) return false;
  if (!Number.isFinite(candidate.createdAt)) return false;
  if (candidate.createdAt < lastApplied.createdAt) return true;
  if (candidate.createdAt > lastApplied.createdAt) return false;
  if (candidate.action === WEBHOOK_ACTION.SUSPEND && lastApplied.action !== WEBHOOK_ACTION.SUSPEND) {
    return false;
  }
  return true;
}

const CANCEL_STATE_ACTIONS = Object.freeze(new Set([WEBHOOK_ACTION.ACTIVATE, WEBHOOK_ACTION.CANCEL_SCHEDULED]));

async function cancelAtPeriodEndAtStripe(billing, subscriptionId) {
  try {
    const abo = await billing.retrieveSubscription(subscriptionId);
    return typeof abo.cancelAtPeriodEnd === "boolean" ? abo.cancelAtPeriodEnd : null;
  } catch {
    return null;
  }
}

function tenantHoldsSubscription(store, tenant, subscriptionId) {
  return store.tenantSubscription(tenant).subscriptionId === subscriptionId;
}

async function syncCancelStateFromStripe(interpreted, { store, billing }) {
  const { action, tenantRef, subscriptionId } = interpreted;
  if (!CANCEL_STATE_ACTIONS.has(action) || !subscriptionId) return;
  const { tenant } = resolveExistingTenant(
    store,
    tenantRef,
    () => store.findTenantBySubscription(subscriptionId)?.id || null,
  );
  if (!tenant || !tenantHoldsSubscription(store, tenant, subscriptionId)) return;
  const atStripe = await cancelAtPeriodEndAtStripe(billing, subscriptionId);
  if (atStripe === null || !tenantHoldsSubscription(store, tenant, subscriptionId)) return;
  if (store.tenantSubscription(tenant).cancelAtPeriodEnd === atStripe) return;
  store.setTenantSubscription(tenant, { cancelAtPeriodEnd: atStripe });
}

function nutzbaresRegister(register) {
  return FUNKTION.safeParse(register?.mitSchluessel).success ? register : null;
}

function hatteWirkung(outcome) {
  return Boolean(outcome) && outcome.tenant !== null;
}

async function applyInProcess({ key, candidate, event }, deps) {
  const lastAppliedByKey = lastAppliedOf(deps.store);
  const stale = isStaleEvent(lastAppliedByKey.get(key), candidate);
  const outcome = stale ? undefined : await applyStripeWebhook(event, deps);
  if (!stale) lastAppliedByKey.set(key, candidate);
  return outcome;
}

function applyWithRegister(register, { key, candidate, event }, deps) {
  return register.mitSchluessel(key, async ({ letzter, eintragen }) => {
    if (isStaleEvent(letzter, candidate)) return undefined;
    const outcome = await applyStripeWebhook(event, deps);
    if (!hatteWirkung(outcome)) return outcome;
    await deps.store.drainFlushes();
    await eintragen(candidate);
    return outcome;
  });
}

export async function applyStripeWebhookSerialized(event, deps) {
  const interpreted = interpretStripeEvent(event);
  if (interpreted.action === WEBHOOK_ACTION.IGNORE) return;
  const key = interpreted.subscriptionId || interpreted.tenantRef || interpreted.customerId;
  if (!key) return applyStripeWebhook(event, deps);
  const candidate = eventAnchorOf(event, interpreted.action);
  const register = nutzbaresRegister(deps.store.stripeEreignisRegister);
  const ereignis = { key, candidate, event };
  return webhookLock(key, async () => {
    const outcome = register
      ? await applyWithRegister(register, ereignis, deps)
      : await applyInProcess(ereignis, deps);
    await syncCancelStateFromStripe(interpreted, deps);
    return outcome;
  });
}
