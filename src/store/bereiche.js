export function speicherBereiche(speicher) {
  return {
    einstellungen: {
      resolveProfile: async (tenantId) => speicher.resolveProfile(tenantId),
      setProfile: async (tenantId, tier) => speicher.setProfile(tenantId, tier),
      updateSettings: async (tenantId, patch) => speicher.updateSettings(tenantId, patch),
      recordCostProfile: async (callId, profil) => speicher.recordCostProfile(callId, profil),
    },
    newsletter: {
      tenantNewsletterConsent: async (tenantId) => speicher.tenantNewsletterConsent(tenantId),
      tenantNewsletterRecipients: async (tenantId) => speicher.tenantNewsletterRecipients(tenantId),
      confirmedNewsletterRecipients: async (tenantId) => speicher.confirmedNewsletterRecipients(tenantId),
      setNewsletterConsent: async (tenantId, consent) => speicher.setNewsletterConsent(tenantId, consent),
      removeNewsletterRecipient: async (tenantId, email) => speicher.removeNewsletterRecipient(tenantId, email),
      confirmNewsletterRecipientByToken: async (tokenHash, nowIso) =>
        speicher.confirmNewsletterRecipientByToken(tokenHash, nowIso),
      unsubscribeNewsletterRecipientByToken: async (token) => speicher.unsubscribeNewsletterRecipientByToken(token),
    },
  };
}
