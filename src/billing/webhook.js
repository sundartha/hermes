import crypto from "node:crypto";
import { activatePaidTenant, profileAuditDetail } from "./activation.js";
import { provisionAuditDetail } from "./provision-outcome.js";
import { bindPaymentMethodOnTenant, customerMatches } from "./card-setup.js";
import { enumOrNull } from "./provider-enum.js";
import { hasCardOnFile } from "../self-service.js";
import { makeKeyedChainMutex } from "../chain-mutex.js";
import { isKnownPlanSlug } from "../plans.js";
import { moneyActionFor, graceDueAtIso, MONEY_ACTION, MONEY_EVENT } from "./money-events.js";
import { attemptContractEndCleanup } from "./contract-end-cleanup.js";
import { clearSubscriptionReference } from "./subscribe.js";

const SIGNATURE_TOLERANCE_S = 300;

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
  if (typeof header !== "string" || header.length === 0) return null;
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
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
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

export function interpretStripeEvent(event) {
  const object = (event && event.data && event.data.object) || {};
  switch (event && event.type) {
    case SUBSCRIPTION_EVENT.CREATED:
    case SUBSCRIPTION_EVENT.UPDATED: {
      if (!CONFIRMED_SUBSCRIPTION_STATUS.has(object.status)) {
        return { action: WEBHOOK_ACTION.IGNORE, tenantRef: null, subscriptionId: null };
      }
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
    case SUBSCRIPTION_EVENT.DELETED:
      return {
        action: WEBHOOK_ACTION.SUSPEND,
        suspendReason: SUSPEND_REASON.SUBSCRIPTION_DELETED,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.id ?? null,
      };
    case SUBSCRIPTION_EVENT.PAYMENT_FAILED:
      return {
        action: WEBHOOK_ACTION.SUSPEND,
        suspendReason: SUSPEND_REASON.PAYMENT_FAILED,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.subscription ?? null,
      };
    default: {
      const money = moneyActionFor(event && event.type);
      if (!money) return { action: WEBHOOK_ACTION.IGNORE, tenantRef: null, subscriptionId: null };
      return {
        action: WEBHOOK_ACTION.MONEY,
        tenantRef: tenantRefOf(object),
        subscriptionId: moneyEventSubscriptionId(event.type, object),
        customerId: object.customer ?? null,
        moneyAction: money.action,
        moneyAlarm: money.alarm,
      };
    }
  }
}

function moneyEventSubscriptionId(type, object) {
  if (type === MONEY_EVENT.SUBSCRIPTION_PAUSED) return object.id ?? null;
  if (type === MONEY_EVENT.PAYMENT_ACTION_REQUIRED) return object.subscription ?? null;
  return null;
}

export function paymentMethodIdOf(defaultPaymentMethod) {
  if (typeof defaultPaymentMethod === "string") return defaultPaymentMethod;
  return (defaultPaymentMethod && defaultPaymentMethod.id) || null;
}

export function paymentMethodTypeOf(defaultPaymentMethod) {
  if (!defaultPaymentMethod || typeof defaultPaymentMethod !== "object") return null;
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
  const { tenant, reason: unresolved } = resolveExistingTenant(
    store,
    tenantRef,
    () => store.findTenantBySubscription(subscriptionId)?.id || null,
  );
  if (!tenant) {
    audit("stripe_webhook_ignored", req, `action=${action} ${unresolvedTenantDetail(unresolved, tenantRef)}`);
    return;
  }
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
  const endedViaCancellation = store.tenantSubscription(tenant).cancelAtPeriodEnd;
  await accounts.setStatus(tenant, "suspended");
  store.setSuspendedAtIfAbsent(tenant);
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
    audit("stripe_money_event_ignored", req, unresolvedTenantDetail(unresolved, tenantRef));
    return { action: WEBHOOK_ACTION.MONEY, tenant: null, alarm: null };
  }
  applyMoneyAction(store, tenant, moneyAction);
  return {
    action: WEBHOOK_ACTION.MONEY,
    tenant,
    alarm: moneyAlarm
      ? { prefix: MONEY_EVENT_ALARM_SMS_PREFIX, detail: `type=${eventType} tenant=${tenant}` }
      : null,
  };
}

function applyMoneyAction(store, tenant, moneyAction) {
  switch (moneyAction) {
    case MONEY_ACTION.WARN:
      return;
    case MONEY_ACTION.REVOKE_PERIOD_CREDIT:
      store.setTenantSubscription(tenant, { periodCreditRevoked: true });
      return;
    case MONEY_ACTION.HOLD_OUTBOUND:
      store.setBillingHold(tenant, { reason: "paused" });
      return;
    case MONEY_ACTION.GRACE_THEN_HOLD:
      store.setBillingHold(tenant, {
        reason: "payment_action",
        dueAtIso: graceDueAtIso(new Date().toISOString()),
      });
      return;
    default:
      return;
  }
}

const webhookLock = makeKeyedChainMutex();

const lastAppliedByKey = new Map();

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

export async function applyStripeWebhookSerialized(event, deps) {
  const interpreted = interpretStripeEvent(event);
  if (interpreted.action === WEBHOOK_ACTION.IGNORE) return;
  const key = interpreted.subscriptionId || interpreted.tenantRef || interpreted.customerId;
  if (!key) return applyStripeWebhook(event, deps);
  const candidate = eventAnchorOf(event, interpreted.action);
  return webhookLock(key, async () => {
    if (isStaleEvent(lastAppliedByKey.get(key), candidate)) return;
    const outcome = await applyStripeWebhook(event, deps);
    lastAppliedByKey.set(key, candidate);
    return outcome;
  });
}
