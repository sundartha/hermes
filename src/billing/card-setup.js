import { CustomerMissingError } from "./errors.js";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureCustomer({ store, billing, tenant }) {
  let { customerId } = store.tenantStripe(tenant);
  if (!customerId) {
    ({ customerId } = await billing.createCustomer({ tenantRef: tenant }));
    store.setTenantStripe(tenant, { customerId });
  }
  return customerId;
}

export async function startCheckoutWithStaleCustomerHeal(
  { store, billing, tenant, retryDelayMs, sleep = defaultSleep },
  startCheckout,
) {
  const customerId = await ensureCustomer({ store, billing, tenant });
  try {
    return { session: await startCheckout(customerId), healed: false };
  } catch (err) {
    if (!(err instanceof CustomerMissingError)) throw err;
    clearTenantPaymentMethod(store, tenant);
    const freshCustomerId = await ensureCustomer({ store, billing, tenant });
    if (retryDelayMs > 0) await sleep(retryDelayMs);
    return { session: await startCheckout(freshCustomerId), healed: true };
  }
}

export function customerMatches(store, tenant, customerId) {
  const { customerId: stored } = store.tenantStripe(tenant);
  return !!stored && stored === customerId;
}

export function bindPaymentMethodOnTenant(
  store,
  tenant,
  { customerId, paymentMethodId, paymentMethodType },
) {
  const patch = { paymentMethodId, paymentMethodType: paymentMethodType ?? null };
  if (customerId !== undefined) patch.customerId = customerId;
  store.setTenantStripe(tenant, patch);
}

export function clearTenantPaymentMethod(store, tenant) {
  store.setTenantStripe(tenant, {
    customerId: null,
    paymentMethodId: null,
    paymentMethodType: null,
  });
}

export async function bindCardFromSession({ store, billing, tenant, sessionId }) {
  const { customerId, paymentMethodId, paymentMethodType } =
    await billing.getCheckoutSessionResult(sessionId);
  if (!customerMatches(store, tenant, customerId)) return { ok: false };
  bindPaymentMethodOnTenant(store, tenant, { customerId, paymentMethodId, paymentMethodType });
  return { ok: true };
}
