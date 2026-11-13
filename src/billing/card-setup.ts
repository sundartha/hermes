import { CustomerMissingError } from "./errors.ts";

interface Store {
  tenantStripe: (tenant: string) => { customerId?: string | null };
  setTenantStripe: (tenant: string, patch: TenantStripePatch) => void;
}

interface Billing {
  createCustomer: (args: { tenantRef: string }) => Promise<{ customerId: string }>;
  getCheckoutSessionResult: (sessionId: string) => Promise<{
    customerId: string;
    paymentMethodId: string;
    paymentMethodType?: string | null;
  }>;
}

interface TenantStripePatch {
  customerId?: string | null;
  paymentMethodId?: string | null;
  paymentMethodType?: string | null;
}

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureCustomer({
  store,
  billing,
  tenant,
}: {
  store: Store;
  billing: Billing;
  tenant: string;
}): Promise<string> {
  let { customerId } = store.tenantStripe(tenant);
  if (!customerId) {
    ({ customerId } = await billing.createCustomer({ tenantRef: tenant }));
    store.setTenantStripe(tenant, { customerId });
  }
  return customerId;
}

export async function startCheckoutWithStaleCustomerHeal<Session>(
  {
    store,
    billing,
    tenant,
    retryDelayMs,
    sleep = defaultSleep,
  }: {
    store: Store;
    billing: Billing;
    tenant: string;
    retryDelayMs: number;
    sleep?: (ms: number) => Promise<unknown>;
  },
  startCheckout: (customerId: string) => Promise<Session>,
): Promise<{ session: Session; healed: boolean }> {
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

export function customerMatches(store: Store, tenant: string, customerId: string): boolean {
  const { customerId: stored } = store.tenantStripe(tenant);
  return !!stored && stored === customerId;
}

export function bindPaymentMethodOnTenant(
  store: Store,
  tenant: string,
  {
    customerId,
    paymentMethodId,
    paymentMethodType,
  }: {
    customerId?: string | null | undefined;
    paymentMethodId: string | null;
    paymentMethodType?: string | null | undefined;
  },
): void {
  const patch: TenantStripePatch = { paymentMethodId, paymentMethodType: paymentMethodType ?? null };
  if (customerId !== undefined) patch.customerId = customerId;
  store.setTenantStripe(tenant, patch);
}

export function clearTenantPaymentMethod(store: Store, tenant: string): void {
  store.setTenantStripe(tenant, {
    customerId: null,
    paymentMethodId: null,
    paymentMethodType: null,
  });
}

export async function bindCardFromSession({
  store,
  billing,
  tenant,
  sessionId,
}: {
  store: Store;
  billing: Billing;
  tenant: string;
  sessionId: string;
}): Promise<{ ok: boolean }> {
  const { customerId, paymentMethodId, paymentMethodType } =
    await billing.getCheckoutSessionResult(sessionId);
  if (!customerMatches(store, tenant, customerId)) return { ok: false };
  bindPaymentMethodOnTenant(store, tenant, { customerId, paymentMethodId, paymentMethodType });
  return { ok: true };
}
