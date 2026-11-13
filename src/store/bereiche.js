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
    rueckfrage: {
      ackConsult: async (callId, eingabe) => speicher.ackConsult(callId, eingabe),
      answerConsult: async (callId, eingabe) => speicher.answerConsult(callId, eingabe),
      emitConsult: async (callId, fragen) => speicher.emitConsult(callId, fragen),
      advanceInCallConsult: async (callId, eingabe) => speicher.advanceInCallConsult(callId, eingabe),
      noteConsultPoll: async (callId) => speicher.noteConsultPoll(callId),
      markConsultAskDelivered: async (callId, eventId) => speicher.markConsultAskDelivered(callId, eventId),
      pendingConsult: async (callId, nachEventId) => speicher.pendingConsult(callId, nachEventId),
      timeOutStagedConsult: async (callId, eingabe) => speicher.timeOutStagedConsult(callId, eingabe),
    },
    recherche: {
      addLookupFacts: async (callId, fakten) => speicher.addLookupFacts(callId, fakten),
      finishCallLookup: async (callId, laufnummer, eingabe) =>
        speicher.finishCallLookup(callId, laufnummer, eingabe),
    },
  };
}
