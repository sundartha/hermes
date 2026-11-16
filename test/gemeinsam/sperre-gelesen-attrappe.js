export function mitSperreGelesen(store) {
  return Object.assign(store, {
    mandantSperreGelesen: (tenantId) => ({
      kycReached: (minLevel) => store.kycReached(tenantId, minLevel),
      inactive: () => store.tenantInactive(tenantId),
      billingHold: () => store.billingHoldActive(tenantId),
      activeSubscriber: (minLevel) => store.tenantActiveSubscriber(tenantId, minLevel),
    }),
  });
}
