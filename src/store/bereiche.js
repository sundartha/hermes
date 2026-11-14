import { NUMBER_STATUS } from "../begriffe/nummern.js";
import * as ausfall from "./zustand/ausfall.js";
import { allTenantIds } from "./zustand/listen.js";
import {
  claimOutageAlert,
  markTenantNeedsManualReconcile,
  openOutageAlert,
} from "./zustand/nummern.js";

function unterSperre(speicher, block) {
  return speicher.withStoreLock(() => {
    const ergebnis = block(speicher.load());
    speicher.save();
    return ergebnis;
  });
}

function ausfallBereich(speicher) {
  return {
    sendeplatzReserviert: async (eingabe) => ausfall.sendeplatzReserviert(speicher.load(), eingabe),
    sendeplatzReservieren: async (eingabe) =>
      speicher.withStoreLock(() => {
        const reserviert = ausfall.sendeplatzReservieren(speicher.load(), eingabe);
        if (reserviert) speicher.save();
        return reserviert;
      }),
    urteilClaimen: async (eingabe) =>
      unterSperre(speicher, (zustand) => ausfall.urteilClaimen(zustand, eingabe)),
    alarmVersendet: async (eingabe) =>
      unterSperre(speicher, (zustand) => ausfall.alarmVersendet(zustand, eingabe)),
    notizClaimen: async (eingabe) =>
      unterSperre(speicher, (zustand) => ausfall.notizClaimen(zustand, eingabe)),
    markerSchliessen: async (eingabe) =>
      unterSperre(speicher, (zustand) => ausfall.markerSchliessen(zustand, eingabe)),
    holdEskalationClaimen: async (eingabe) =>
      unterSperre(speicher, (zustand) => ausfall.holdEskalationClaimen(zustand, eingabe)),
    selbsttestClaimen: async (eingabe) =>
      unterSperre(speicher, (zustand) => ausfall.selbsttestClaimen(zustand, eingabe)),
    offeneAusfallZustand: async () => ausfall.offeneAusfallZustand(speicher.load()),
    holdKandidaten: async (eingabe) => ausfall.holdKandidaten(speicher.load(), eingabe),
    beanspruchMarker: async ({ code, nowMs, istFaellig }) => {
      const beansprucht = await speicher.withStoreLock(() => {
        const zustand = speicher.load();
        if (!istFaellig(openOutageAlert(zustand, code))) return false;
        claimOutageAlert(zustand, { code, nowMs });
        return true;
      });
      speicher.save();
      return beansprucht;
    },
  };
}

function nummernkaufBereich(speicher) {
  return {
    ensureTenant: async (tenantId) => speicher.ensureTenant(tenantId),
    alleMandantenIds: async () => allTenantIds(speicher.load()),
    markTenantNeedsManualReconcile: async (tenantId) =>
      speicher.withStoreLock(() => {
        if (markTenantNeedsManualReconcile(speicher.load(), tenantId).changed) speicher.save();
      }),
  };
}

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
      confirmedNewsletterRecipients: async (tenantId) =>
        speicher.confirmedNewsletterRecipients(tenantId),
      setNewsletterConsent: async (tenantId, consent) =>
        speicher.setNewsletterConsent(tenantId, consent),
      removeNewsletterRecipient: async (tenantId, email) =>
        speicher.removeNewsletterRecipient(tenantId, email),
      confirmNewsletterRecipientByToken: async (tokenHash, nowIso) =>
        speicher.confirmNewsletterRecipientByToken(tokenHash, nowIso),
      unsubscribeNewsletterRecipientByToken: async (token) =>
        speicher.unsubscribeNewsletterRecipientByToken(token),
    },
    rueckfrage: {
      ackConsult: async (callId, eingabe) => speicher.ackConsult(callId, eingabe),
      answerConsult: async (callId, eingabe) => speicher.answerConsult(callId, eingabe),
      emitConsult: async (callId, fragen) => speicher.emitConsult(callId, fragen),
      advanceInCallConsult: async (callId, eingabe) =>
        speicher.advanceInCallConsult(callId, eingabe),
      noteConsultPoll: async (callId) => speicher.noteConsultPoll(callId),
      markConsultAskDelivered: async (callId, eventId) =>
        speicher.markConsultAskDelivered(callId, eventId),
      pendingConsult: async (callId, nachEventId) => speicher.pendingConsult(callId, nachEventId),
      timeOutStagedConsult: async (callId, eingabe) =>
        speicher.timeOutStagedConsult(callId, eingabe),
    },
    recherche: {
      addLookupFacts: async (callId, fakten) => speicher.addLookupFacts(callId, fakten),
      finishCallLookup: async (callId, laufnummer, eingabe) =>
        speicher.finishCallLookup(callId, laufnummer, eingabe),
    },
    posteingang: {
      callActionItems: async (callId) => speicher.callActionItems(callId),
      addActionItem: async (callId, text, art) => speicher.addActionItem(callId, text, art),
      markInboxEntry: async (callId, qualifiziert) => speicher.markInboxEntry(callId, qualifiziert),
      takeInboxEntries: async (tenantId, optionen) => speicher.takeInboxEntries(tenantId, optionen),
    },
    anrufe: {
      addTranscript: async (callId, rolle, text) => speicher.addTranscript(callId, rolle, text),
      countNoSpeechTurn: async (callId) => speicher.countNoSpeechTurn(callId),
      clearNoSpeechStreak: async (callId) => speicher.clearNoSpeechStreak(callId),
      numberRecordByE164: async (e164) => speicher.numberRecordByE164(e164),
      resolveCallLanguage: async (eingabe) => speicher.resolveCallLanguage(eingabe),
    },
    gespraech: {
      getCall: async (callId) => speicher.getCall(callId),
      countCallerTurn: async (callId) => speicher.countCallerTurn(callId),
    },
    kostenbelege: {
      callCostEvidence: async (callId) => speicher.callCostEvidence(callId),
      recordCallCostEvidence: async (eintrag) => speicher.recordCallCostEvidence(eintrag),
      markCostCrossCheckAttempted: async (monatsschluessel) =>
        speicher.markCostCrossCheckAttempted(monatsschluessel),
    },
    tts: {
      platformTtsUsageView: async (nowIso) => speicher.platformTtsUsageView(nowIso),
    },
    mandant: {
      tenantContext: async (tenantId) => speicher.tenantContext(tenantId),
    },
    konto: {
      exportTenantData: async (tenantId) => speicher.exportTenantData(tenantId),
      tenantPrivateNumber: async (tenantId) => speicher.tenantPrivateNumber(tenantId),
      setPrivateNumber: async (tenantId, nummer) => speicher.setPrivateNumber(tenantId, nummer),
      tenantStripe: async (tenantId) => speicher.tenantStripe(tenantId),
      tenantSubscription: async (tenantId) => speicher.tenantSubscription(tenantId),
    },
    ausfall: ausfallBereich(speicher),
    nummern: {
      nummerntauschKandidaten: async (optionen) => speicher.nummerntauschKandidaten(optionen),
      ersatzNummerAnfordern: async (eingabe) => speicher.ersatzNummerAnfordern(eingabe),
      registrierungAnhaengen: async (numberId, phoneNumberId) =>
        speicher.registrierungAnhaengen(numberId, phoneNumberId),
      markNumberElInboundTrunkBelegt: async (numberId, daten) =>
        speicher.markNumberElInboundTrunkBelegt(numberId, daten),
      clearNumberElInboundTrunkBeleg: async (numberId) =>
        speicher.clearNumberElInboundTrunkBeleg(numberId),
      aktiveNummern: async () =>
        speicher.load().numbers.filter((nummer) => nummer.status === NUMBER_STATUS.ACTIVE),
    },
    nummernkauf: nummernkaufBereich(speicher),
  };
}
