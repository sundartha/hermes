// F2-Mail: Ziel- und Sende-Entscheidung fuer die Call-Summary-Mail nach einem beendeten
// Anruf (Auftrag: Newsletter-Einwilligung -> Zusammenfassung per E-Mail). Spiegel von
// sms-summary.js (planSummarySms) - dieselbe Trennung: reine Entscheidung hier, der
// Mail-Text wird beim Aufrufer gebaut (finishCall, call-finish.js), Muster SMS-Body.
//
// Reine LESE-Entscheidung mit EINER I/O-Ausnahme: accounts.accountByTenant ist async
// (pg-Lookup der Konto-E-Mail, web-auth.js) - anders als planSummarySms (komplett
// synchron/lesend), weil das Ziel dieser Mail NICHT am Store liegt, sondern am
// separaten Accounts-Adapter. Deshalb ist planSummaryMail async; der DB-Lookup laeuft
// erst NACH allen guenstigen synchronen Gates, damit ein Skip aus einem der Gruende nie
// einen unnoetigen Netz-Call ausloest.
//
// F2-Newsletter-Recipients: die Konto-Adresse (Boolean-Consent) und die CONFIRMED-
// Zusatzempfaenger (Double-Opt-in, newsletter-recipients.js) sind ZWEI ORTHOGONALE
// Ziel-Achsen (Auftrag: additiv, der Boolean-Pfad bleibt unangetastet) - ein Tenant kann
// Consent=false UND bestaetigte Zusatzempfaenger haben, oder umgekehrt. planSummaryMail
// liefert deshalb `targets[]` statt eines einzelnen `to`; jedes Ziel traegt sein eigenes
// unsubToken (null fuer die Konto-Adresse - sie hat kein Abmelde-Recht ueber diesen Kanal,
// der Boolean-Widerruf bleibt ihr Weg), das der Aufrufer fuer den Abmelde-Link-Footer
// braucht (nur Zusatzadressen bekommen ihn, Owner-Auftrag).
//
// Signatur bewusst EIN Options-Objekt (F1: max. 3 Argumente, 0-2 anstreben).
//
// Garantien:
//  - Gates in fester Reihenfolge, jede mit Reason (Skip-Audit in finishCall) oder ohne
//    (normaler Skip, kein Ziel-Defizit - Muster planSummarySms):
//    (a) Dedup-Marker call.summaryMailSentAt gesetzt -> skip, KEIN reason (Restart-Retry,
//        kein Defizit).
//    (b) kein Mailer konfiguriert (mailer=null, config.mail.smtpHost fehlt) -> skip,
//        reason="no_mailer".
//    (c) keine Summary vorhanden (call.summary fehlt - z.B. leere Modellantwort trotz
//        allowSummaries) -> skip, KEIN reason (internes Praezedenzfall, kein Ziel-Defizit).
//    (d) Konto-Ziel: NUR wenn tenantNewsletterConsent(...).consent === true; fehlt dann
//        zusaetzlich die Konto-E-Mail -> reason="no_account_email" (aber NUR final sichtbar,
//        wenn am Ende gar kein Ziel zustande kommt - s. unten).
//    (e) Zusatzziele: alle CONFIRMED Eintraege aus store.confirmedNewsletterRecipients.
//  - targets.length === 0 -> send=false. reason ist "no_account_email" GENAU DANN, wenn
//    Consent=true war, aber die Konto-E-Mail fehlte, UND keine bestaetigten Zusatzempfaenger
//    existieren (sonst waere "kein Ziel" trotz vorhandenem Consent-Defizit irrefuehrend
//    reasonlos) - in jedem anderen Leer-Fall (kein Consent, keine Zusatzempfaenger) bleibt
//    reason=null (kein Betriebsdefekt, Muster SMS-Opt-out).
//  - KEIN Tages-Cap fuer den VERSAND (bewusste Entscheidung, s. Auftrag): das Mail-Volumen
//    ist 1:1 an beendete Anrufe gekoppelt, und Anrufe sind bereits an anderer Stelle budget-/
//    gate-begrenzt (Tenant-Kostendecke, Max-Gespraechsdauer, Outbound-Gates) - eine zweite,
//    unabhaengige Kappe haette hier keinen Angriffsvektor zu schliessen, den es nicht schon
//    gibt. (Das Tageslimit der BESTAETIGUNGS-Mails beim Eintragen ist ein separates Gate,
//    s. newsletter-recipients.js NEWSLETTER_CONFIRM_MAIL_DAILY_CAP.)

export async function planSummaryMail({ store, call, mailer, accounts }) {
  if (call.summaryMailSentAt) return { send: false, targets: [], reason: null };
  if (!mailer) return { send: false, targets: [], reason: "no_mailer" };
  if (!call.summary) return { send: false, targets: [], reason: null };

  const targets = [];
  let reason = null;

  // store.tenantNewsletterConsent/confirmedNewsletterRecipients sind die Store-FASSADE
  // (json.js/pg.js exportieren beide, Muster tenantPrivateNumber) - reicht bis hierher als
  // injizierte Abhaengigkeit durch, kein direkter state-ops-Import (haelt diese Datei
  // store-backend-agnostisch, wie sms-summary.js).
  const consent = store.tenantNewsletterConsent(call.tenantId);
  if (consent?.consent === true) {
    const account = accounts ? await accounts.accountByTenant(call.tenantId) : null;
    if (account?.email) targets.push({ email: account.email, unsubToken: null });
    else reason = "no_account_email";
  }

  for (const recipient of store.confirmedNewsletterRecipients(call.tenantId)) {
    targets.push({ email: recipient.email, unsubToken: recipient.unsubToken });
  }

  if (!targets.length) return { send: false, targets: [], reason };
  return { send: true, targets, reason: null };
}
