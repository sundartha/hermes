// F2-Mail: Ziel- und Sende-Entscheidung fuer die Call-Summary-Mail nach einem beendeten
// Anruf (Auftrag: Newsletter-Einwilligung -> Zusammenfassung per E-Mail). Spiegel von
// sms-summary.js (planSummarySms) - dieselbe Trennung: reine Entscheidung hier, der
// Mail-Text wird beim Aufrufer gebaut (finishCall, call-finish.js), Muster SMS-Body.
//
// Reine LESE-Entscheidung mit EINER I/O-Ausnahme: accounts.accountByTenant ist async
// (pg-Lookup der Konto-E-Mail, web-auth.js) - anders als planSummarySms (komplett
// synchron/lesend), weil das Ziel dieser Mail NICHT am Store liegt, sondern am
// separaten Accounts-Adapter. Deshalb ist planSummaryMail async; der DB-Lookup laeuft
// erst NACH allen guenstigen synchronen Gates (a)-(d), damit ein Skip aus einem der
// vier Gruende nie einen unnoetigen Netz-Call ausloest.
//
// Signatur bewusst EIN Options-Objekt (F1: max. 3 Argumente, 0-2 anstreben) statt der
// planSummarySms-Positionsliste (store, config, call) - mit mailer/accounts kommen zwei
// weitere Kollaboratoren dazu, die planSummarySms nicht kennt (config wird hier NICHT
// gebraucht: es gibt keinen globalen Mail-Feature-Schalter wie config.voice.sendSmsSummary
// - "konfiguriert oder nicht" IST bereits die mailer-Praesenz, Gate (b)).
//
// Garantien:
//  - Gates in fester Reihenfolge, jede mit Reason (Skip-Audit in finishCall) oder ohne
//    (normaler Skip, kein Ziel-Defizit - Muster planSummarySms):
//    (a) Dedup-Marker call.summaryMailSentAt gesetzt -> skip, KEIN reason (Restart-Retry,
//        kein Defizit).
//    (b) kein Mailer konfiguriert (mailer=null, config.mail.smtpHost fehlt) -> skip,
//        reason="no_mailer".
//    (c) Newsletter-Einwilligung fehlt (tenantNewsletterConsent(...).consent !== true) ->
//        skip, KEIN reason (Opt-in-Stand ist kein Betriebsdefekt, Muster SMS-Opt-out).
//    (d) keine Summary vorhanden (call.summary fehlt - z.B. leere Modellantwort trotz
//        allowSummaries) -> skip, KEIN reason (internes Praezedenzfall, kein Ziel-Defizit).
//    (e) keine Konto-E-Mail hinterlegt (kein accounts-Adapter ODER
//        accountByTenant liefert null/keine email) -> skip, reason="no_account_email".
//  - KEIN Tages-Cap (bewusste Entscheidung, s. Auftrag): das Mail-Volumen ist 1:1 an
//    beendete Anrufe gekoppelt, und Anrufe sind bereits an anderer Stelle budget-/
//    gate-begrenzt (Tenant-Kostendecke, Max-Gespraechsdauer, Outbound-Gates) - eine
//    zweite, unabhaengige Kappe haette hier keinen Angriffsvektor zu schliessen, den es
//    nicht schon gibt, und wuerde nur eine weitere Konstante pflegen.

export async function planSummaryMail({ store, call, mailer, accounts }) {
  if (call.summaryMailSentAt) return { send: false, to: null, reason: null };
  if (!mailer) return { send: false, to: null, reason: "no_mailer" };
  // store.tenantNewsletterConsent ist die Store-FASSADE (json.js/pg.js exportieren sie
  // beide, Muster tenantPrivateNumber) - reicht bis hierher als injizierte Abhaengigkeit
  // durch, kein direkter state-ops-Import (haelt diese Datei store-backend-agnostisch,
  // wie sms-summary.js).
  const consent = store.tenantNewsletterConsent(call.tenantId);
  if (consent?.consent !== true) return { send: false, to: null, reason: null };
  if (!call.summary) return { send: false, to: null, reason: null };
  const account = accounts ? await accounts.accountByTenant(call.tenantId) : null;
  if (!account?.email) return { send: false, to: null, reason: "no_account_email" };
  return { send: true, to: account.email, reason: null };
}
