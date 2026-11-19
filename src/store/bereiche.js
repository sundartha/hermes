import { NUMBER_STATUS } from "../begriffe/nummern.js";
import { SKIP_VERMERK_SCHLUESSEL } from "../begriffe/nummern-vergabe.js";
import * as ausfall from "./zustand/ausfall.js";
import { expireOrphanedConsults } from "./state-ops.js";
import { tenantLanguage } from "./views.ts";
import * as kostenabgleich from "./zustand/kostenabgleich.js";
import {
  allTenantIds,
  tenantsForPaymentMethodTypeReconcile,
  tenantsForStaleSubscriptionReconcile,
  tenantsForStripeReconcile,
  tenantsMitProfilen,
} from "./zustand/listen.js";
import { setTenantIdentityIfAbsent, tenantGeo } from "./zustand/mandant.ts";
import {
  claimOutageAlert,
  markTenantNeedsManualReconcile,
  openOutageAlert,
  paidWithoutNumberCandidates,
} from "./zustand/nummern.js";

const TRANSKRIPT_FRIST_MS = 500;

async function transkriptMitFrist(callId, ergebnis) {
  const schreiben = Promise.resolve(ergebnis);
  let zeitgeber;
  let abgelaufen = false;
  schreiben.catch((fehler) => {
    if (abgelaufen) {
      console.error(`[transkript] schreiben nach der Frist fehlgeschlagen call=${callId}: ${fehler?.message ?? fehler}`);
    }
  });
  const ablauf = new Promise((aufgeloest) => {
    zeitgeber = setTimeout(() => {
      abgelaufen = true;
      console.warn("[transkript] schreiben ueber die Frist, Antwort geht ohne Bestaetigung weiter");
      aufgeloest(undefined);
    }, TRANSKRIPT_FRIST_MS);
  });
  try {
    return await Promise.race([schreiben, ablauf]);
  } finally {
    clearTimeout(zeitgeber);
  }
}

function unterSperre(speicher, block) {
  return speicher.withStoreLock(() => {
    const ergebnis = block(speicher.load());
    speicher.save();
    return ergebnis;
  });
}

function mandantProfilBereich(speicher) {
  return {
    tenantLanguage: async (tenantId) => tenantLanguage(speicher.load(), tenantId),
    tenantGeo: async (tenantId) => tenantGeo(speicher.load(), tenantId),
    identitaetSetzen: async (tenantId, identitaet) =>
      speicher.withStoreLock(() => {
        if (!setTenantIdentityIfAbsent(speicher.load(), tenantId, identitaet)) return;
        speicher.save();
        speicher.stammdatenSchreiben(tenantId, ["ownerName", "firstName"]);
      }),
  };
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
    urteilClaimen: async (eingabe) => {
      const calls = await anrufeFuerBericht(speicher);
      return unterSperre(speicher, (zustand) => ausfall.urteilClaimen(zustand, eingabe, calls));
    },
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
    offeneMarkerSchliessen: async (eingabe) => {
      const geschlossen = await speicher.withStoreLock(() =>
        ausfall.offeneMarkerSchliessen(speicher.load(), eingabe),
      );
      speicher.save();
      return geschlossen;
    },
    offenerMarker: async (eingabe) => ausfall.offenerMarker(speicher.load(), eingabe),
    offeneAusfallZustand: async () => ausfall.offeneAusfallZustand(speicher.load(), await anrufeFuerBericht(speicher)),
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

function abgleichBereich(speicher) {
  return {
    stripeKandidaten: async () => tenantsForStripeReconcile(speicher.load()),
    veralteteAboKandidaten: async () => tenantsForStaleSubscriptionReconcile(speicher.load()),
    zahlartTypKandidaten: async () => tenantsForPaymentMethodTypeReconcile(speicher.load()),
    mandantenMitProfilen: async () => tenantsMitProfilen(speicher.load()),
    zahlendOhneNummerKandidaten: async (auswahl) =>
      paidWithoutNumberCandidates(speicher.load(), auswahl),
  };
}

function kostenbelegeBereich(speicher) {
  return {
    callCostEvidence: async (callId) => speicher.callCostEvidence(callId),
    recordCallCostEvidence: async (eintrag) => speicher.recordCallCostEvidence(eintrag),
    markCostCrossCheckAttempted: async (monatsschluessel) =>
      speicher.markCostCrossCheckAttempted(monatsschluessel),
  };
}

async function anrufeFuerBericht(speicher) {
  if (!speicher.exportTenantDataGelesen) return speicher.load().calls;
  return (await speicher.exportTenantDataGelesen(null, { bericht: true })).calls;
}

async function kandidatenImSpiegel(speicher, istKandidat) {
  const kandidaten = (await anrufeFuerBericht(speicher)).filter(istKandidat);
  if (!speicher.leseCall) return kandidaten;
  const gebunden = [];
  for (const kandidat of kandidaten) {
    const call = await speicher.leseCall(kandidat.id);
    if (call) gebunden.push(call);
  }
  return gebunden;
}

function kostenabgleichBereich(speicher) {
  const zustandMitAnrufen = async () => {
    const zustand = speicher.load();
    const calls = await anrufeFuerBericht(speicher);
    return calls === zustand.calls ? zustand : { ...zustand, calls };
  };
  return {
    abgleichZustand: async () => kostenabgleich.abgleichZustand(await zustandMitAnrufen()),
    sweepKandidaten: (istKandidat) => kandidatenImSpiegel(speicher, istKandidat),
    querpruefungMonat: async (nowIso) => kostenabgleich.querpruefungMonat(speicher.load(), nowIso),
    querpruefungSummen: async (eingabe) => kostenabgleich.querpruefungSummen(await zustandMitAnrufen(), eingabe),
  };
}

function kuendigungBereich(speicher) {
  return {
    cancellationMailPending: async (tenantId) => speicher.cancellationMailPending(tenantId),
    setCancellationMailPending: async (tenantId, patch) =>
      speicher.setCancellationMailPending(tenantId, patch),
    tenantsPendingCancellationMail: async () => speicher.tenantsPendingCancellationMail(),
    setTenantSubscription: async (tenantId, patch) =>
      speicher.setTenantSubscription(tenantId, patch),
  };
}

function nummernkaufBereich(speicher) {
  return {
    ensureTenant: async (tenantId) => speicher.ensureTenant(tenantId),
    alleMandantenIds: async () => allTenantIds(speicher.load()),
    markTenantNeedsManualReconcile: async (tenantId) =>
      speicher.withStoreLock(() => {
        if (!markTenantNeedsManualReconcile(speicher.load(), tenantId).changed) return;
        speicher.save();
        speicher.stammdatenSchreiben?.(tenantId, SKIP_VERMERK_SCHLUESSEL);
      }),
  };
}

function anrufeFuerZustandVon(speicher) {
  return async (tenantId, limit) => {
    const auszug = speicher.exportTenantDataGelesen
      ? await speicher.exportTenantDataGelesen(tenantId, { anrufe: limit })
      : await speicher.exportTenantData(tenantId);
    return auszug.calls.slice(0, limit);
  };
}

function anzahlAnrufeSeitVon(speicher) {
  return async (tenantId, seitIso) => speicher.zaehleAnrufeSeit(tenantId, seitIso);
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
    rueckfrageAbschluss: {
      verwaisteSchliessen: async (callId, eingabe) => {
        if (speicher.leseCall) await speicher.leseCall(callId);
        const { changed } = expireOrphanedConsults(speicher.load(), callId, eingabe);
        if (changed) speicher.save();
      },
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
      addTranscript: async (callId, rolle, text) => transkriptMitFrist(callId, speicher.addTranscript(callId, rolle, text)),
      countNoSpeechTurn: async (callId) => speicher.countNoSpeechTurn(callId),
      clearNoSpeechStreak: async (callId) => speicher.clearNoSpeechStreak(callId),
      numberRecordByE164: async (e164) => speicher.numberRecordByE164(e164),
      resolveCallLanguage: async (eingabe) => speicher.resolveCallLanguage(eingabe),
    },
    gespraech: {
      getCall: async (callId) => speicher.getCall(callId),
      countCallerTurn: async (callId) => speicher.countCallerTurn(callId),
    },
    kostenbelege: kostenbelegeBereich(speicher),
    kostenabgleich: kostenabgleichBereich(speicher),
    tts: {
      platformTtsUsageView: async (nowIso) => speicher.platformTtsUsageView(nowIso),
    },
    mandant: {
      tenantContext: async (tenantId) => speicher.tenantContext(tenantId),
    },
    zustandAnrufe: { anrufeFuerZustand: anrufeFuerZustandVon(speicher), anzahlSeit: anzahlAnrufeSeitVon(speicher) },
    berichtAnrufe: { anrufeFuerBericht: () => anrufeFuerBericht(speicher) },
    mandantProfil: mandantProfilBereich(speicher),
    konto: {
      exportTenantData: async (tenantId) => speicher.exportTenantData(tenantId),
      exportTenantDataGelesen: async (tenantId) => speicher.exportTenantDataGelesen(tenantId),
      tenantPrivateNumber: async (tenantId) => speicher.tenantPrivateNumber(tenantId),
      tenantPrivateNumberLesen: async (tenantId) => speicher.tenantPrivateNumberLesen(tenantId),
      setPrivateNumber: async (tenantId, nummer) => speicher.setPrivateNumber(tenantId, nummer),
      tenantStripe: async (tenantId) => speicher.tenantStripe(tenantId),
      tenantSubscription: async (tenantId) => speicher.tenantSubscription(tenantId),
    },
    abgleich: abgleichBereich(speicher),
    kuendigung: kuendigungBereich(speicher),
    ausfall: ausfallBereich(speicher),
    nummern: {
      nummerntauschKandidaten: async () => speicher.nummerntauschKandidaten(),
      ersatzNummerAnfordern: async (eingabe) => speicher.ersatzNummerAnfordern(eingabe),
      registrierungAnhaengen: async (numberId, phoneNumberId) =>
        speicher.registrierungAnhaengen(numberId, phoneNumberId),
      aktiveNummern: async () =>
        speicher.load().numbers.filter((nummer) => nummer.status === NUMBER_STATUS.ACTIVE),
    },
    nummernkauf: nummernkaufBereich(speicher),
  };
}
