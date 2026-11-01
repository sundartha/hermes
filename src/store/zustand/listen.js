import { TENANT_STATUS } from "../defaults.js";
import { safeEqual } from "../../util.js";
import { MS_PER_DAY } from "../../utils/timer.js";
import { tenantsOf } from "./grundlagen.js";
import { findTenant } from "./mandant.js";

export function allTenantIds(state) {
  return tenantsOf(state).map((tenant) => tenant.id);
}

export function tenantIdpSubject(state, tenantId) {
  return findTenant(state, tenantId)?.idpSubject ?? null;
}

export function setCancellationMailPending(state, tenantId, { pending, receivedAt } = {}) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return null;
  if (pending !== undefined) tenant.cancellationMailPending = pending;
  if (receivedAt !== undefined) tenant.cancellationMailReceivedAt = receivedAt;
  return tenant;
}

export function cancellationMailPending(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return {
    pending: tenant?.cancellationMailPending ?? false,
    receivedAt: tenant?.cancellationMailReceivedAt ?? null,
  };
}

export function tenantsPendingCancellationMail(state) {
  return tenantsOf(state).filter((tenant) => tenant.cancellationMailPending);
}

export function tenantsForStripeReconcile(state) {
  return tenantsOf(state).filter((tenant) => tenant.stripeSubscriptionId && !tenant.suspendedAt);
}

export function tenantsForStaleSubscriptionReconcile(state) {
  return tenantsOf(state).filter(
    (tenant) => tenant.stripeSubscriptionId && tenant.status !== TENANT_STATUS.ACTIVE,
  );
}

export function tenantsForPaymentMethodTypeReconcile(state) {
  return tenantsOf(state).filter(
    (tenant) => tenant.stripePaymentMethodId && !tenant.stripePaymentMethodType,
  );
}

export function setNewsletterConsent(state, tenantId, consent) {
  if (typeof consent !== "boolean")
    throw new Error("setNewsletterConsent: consent muss boolean sein");
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setNewsletterConsent: Tenant ${tenantId} nicht gefunden`);
  tenant.newsletterConsent = consent;
  tenant.newsletterConsentAt = new Date().toISOString();
  return tenant;
}

export function tenantNewsletterConsent(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return {
    consent: tenant?.newsletterConsent === true,
    consentAt: tenant?.newsletterConsentAt ?? null,
  };
}

export function tenantNewsletterRecipients(state, tenantId) {
  return findTenant(state, tenantId)?.newsletterRecipients ?? [];
}

export function confirmedNewsletterRecipients(state, tenantId) {
  return tenantNewsletterRecipients(state, tenantId).filter((recipient) => recipient.status === "confirmed");
}

export function dailyNewsletterConfirmMailCount(state, tenantId, sinceIso) {
  const tenant = findTenant(state, tenantId);
  return (tenant?.newsletterConfirmMailLog ?? []).filter((sentAt) => sentAt >= sinceIso).length;
}

export function addNewsletterRecipient(state, tenantId, { email, tokenHash, tokenExpiresAt, unsubToken, now }) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`addNewsletterRecipient: Tenant ${tenantId} nicht gefunden`);
  const nowIso = now ?? new Date().toISOString();
  tenant.newsletterRecipients ??= [];
  tenant.newsletterRecipients.push({
    email,
    status: "pending",
    createdAt: nowIso,
    confirmedAt: null,
    tokenHash,
    tokenExpiresAt,
    unsubToken,
  });
  const cutoff = new Date(Date.parse(nowIso) - MS_PER_DAY).toISOString();
  tenant.newsletterConfirmMailLog = (tenant.newsletterConfirmMailLog ?? [])
    .filter((sentAt) => sentAt >= cutoff)
    .concat(nowIso);
  return tenant.newsletterRecipients[tenant.newsletterRecipients.length - 1];
}

export function removeNewsletterRecipient(state, tenantId, email) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`removeNewsletterRecipient: Tenant ${tenantId} nicht gefunden`);
  const before = (tenant.newsletterRecipients ?? []).length;
  tenant.newsletterRecipients = (tenant.newsletterRecipients ?? []).filter((recipient) => recipient.email !== email);
  return tenant.newsletterRecipients.length !== before;
}

export function confirmNewsletterRecipientByToken(state, tokenHash, nowIso) {
  for (const tenant of tenantsOf(state)) {
    const match = (tenant.newsletterRecipients ?? []).find(
      (recipient) =>
        recipient.status === "pending" &&
        recipient.tokenHash &&
        safeEqual(recipient.tokenHash, tokenHash) &&
        recipient.tokenExpiresAt > nowIso,
    );
    if (match) {
      match.status = "confirmed";
      match.confirmedAt = nowIso;
      match.tokenHash = null;
      match.tokenExpiresAt = null;
      return { tenantId: tenant.id, email: match.email };
    }
  }
  return null;
}

export function unsubscribeNewsletterRecipientByToken(state, token) {
  for (const tenant of tenantsOf(state)) {
    const recipients = tenant.newsletterRecipients ?? [];
    const idx = recipients.findIndex((recipient) => recipient.unsubToken && safeEqual(recipient.unsubToken, token));
    if (idx !== -1) {
      const [removed] = recipients.splice(idx, 1);
      return { tenantId: tenant.id, email: removed.email };
    }
  }
  return null;
}
