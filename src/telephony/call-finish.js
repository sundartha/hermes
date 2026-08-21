// Call-Finish: Settlement + Summary + Notification + SMS + Mail (finishCall) und die
// Worst-Case-Reserve-Freigabe (releaseReserve). Reine Verschiebung aus server.js
// (Server-Slim P4). Die Factory schliesst store/config/metering/messaging/summarizeCall/
// planSummarySms/audit; USAGE_EVENT_KIND importiert das Modul selbst (EINE Quelle, G5).
// EINE Instanz je Prozess (Wurzel-Scope, INV-7): dieselbe finishCall-Referenz geht an
// attachMediaBridge UND makeCallControlIngest - die In-Memory-Guards (call._finished) und
// der persistierte billedAt-Marker verlangen Identitaet. Die paymentEnabled-Gating-Bedingung
// (Voice-Minuten-Meter) bleibt im finishCall-Body (INV-9); reconcileVoiceBudget
// laeuft immer, releaseReserve wird intra-modul aufgerufen. P2b: die injizierte config
// schliesst zusaetzlich config.privacy (Diagnose-Retention-Frist) - dieselbe Rolle wie
// config.billing fuer das Metering, nur fuer den Roh-Transkript-Purge-Entscheid.
//
// F2-Mail: mailer/accountsRef sind OPTIONAL (Default null/{current:null}) - bestehende
// Aufrufer (Tests, Muster web-14-call-finish-sms-text-language.test.js) bleiben ohne
// Aenderung gueltig, planSummaryMail skip't dann fail-closed mit reason="no_mailer" bzw.
// "no_account_email". accountsRef ist eine spaet gebundene Zelle (Muster operatorAuth,
// app.js): der pg-gated Web-Login-Block (wireWebLogin, server.js/app.js) befuellt
// accountsRef.current ERST NACH der Konstruktion dieser Factory (asynchron, guardedBoot) -
// mailer dagegen ist eine EIGENE, synchron am Modul-Top von server.js konstruierte
// SmtpMailer-Instanz (Begruendung dort), keine Zelle noetig.
import { USAGE_EVENT_KIND } from "../store/defaults.js";
import { keepsTranscriptForDiagnosis } from "../diagnostic-retention.js";
import { localeFor } from "../i18n/locales.js";
import { planSummaryMail } from "../mail-summary.js";
// F2-Newsletter-Recipients: EINE Quelle fuer den Abmelde-Link-URL-Bau (G5), geteilt mit
// self-service-routes.js (Bestaetigungs-Mail-Link nutzt das Confirm-Pendant dort).
import { newsletterUnsubscribeUrl } from "../newsletter-recipients.js";

// Provider-SMS-Segmentgrenze (Zusammenfassungs-SMS wird hierauf gekuerzt).
const SMS_BODY_MAX_CHARS = 1500;

// Die Action Items, die zu DIESEM Anruf bereits im Store stehen - als blosse Texte, in
// derselben Form, die summarizeCall auf dem Bestandsweg liefert (die Zusammenfassungs-SMS
// unten nummeriert sie).
//
// HIER STAND EIN HART GESETZTES [] (nur im Anbieter-Zweig, s. unten): dieser Zweig
// ueberspringt summarizeCall, weil die Zusammenfassung schon am Record steht - und gab
// damit auch die Action Items als "keine" aus, obwohl der Ergebnisabruf sie unmittelbar
// davor geschrieben hat (elevenlabs/outbound.js#persistNextStep laeuft in
// finishFromConversation VOR terminateAndBillCall, also vor dieser Stelle). Die
// Zusammenfassungs-SMS verschwieg den vereinbarten naechsten Schritt deshalb immer.
//
// NUR DER ANBIETER-ZWEIG liest hier: auf dem Bestandsweg bleibt summarizeCall die Quelle
// (dort laeuft store.addActionItem erst NACH dem Rueckgabewert, claude.js), und der Text
// der SMS bleibt dort byte-identisch zum Bestand.
function storedActionItemTexts(store, callId) {
  return store.callActionItems(callId).map((item) => item.text);
}

// F2-Mail: mm:ss-Dauerformat (Sekunden -> Minuten-Bruecke, G25: benannte Konstanten
// statt nackter Zahlen).
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

// F2-Mail: Dauer "m:ss" von answeredAt bis endedAt - eigene, minimale Server-Kopie des
// Anzeige-Musters in apps/web/src/lib/render.js (callDurationLabel): das Frontend-Modul
// ist Browser-Code und darf von src/ nicht importiert werden (Strategie-Grenze). Fehlt
// answeredAt/endedAt (nie abgenommen) -> "" (kein erfundener Wert, gleiches Prinzip wie
// die Frontend-Kopie).
function formatCallDuration(call) {
  const startMs = Date.parse(call.answeredAt || "");
  const endMs = Date.parse(call.endedAt || "");
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "";
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// F2-Mail: Anzeige-Zeitpunkt der Mail - bewusst OHNE jeden Orts-/Zonen-Bezug an
// Intl.DateTimeFormat: diese Datei bleibt strukturell frei von jeder Tenant-
// Ortszeit-Lesung - ein eigener Waechtertest (LAW-07: kein Anrufzeit-Gate,
// Owner-Auflage 7.6) haelt genau das fest. Der Zeitpunkt laeuft daher im
// Laufzeit-Default (Prozess-seitige Voreinstellung), NICHT in der Ortszeit des
// Tenants - eine bewusste Vereinfachung, kein Datenverlust (die Mail nennt
// trotzdem Datum+Uhrzeit des Anrufs).
function mailTimestampLabel(call) {
  const anchorMs = Date.parse(call.answeredAt || call.startedAt);
  if (Number.isNaN(anchorMs)) return "";
  return new Intl.DateTimeFormat(localeFor(call.language).dateLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(anchorMs));
}

// F2-Mail: der Fliesstext, Spiegel des SMS-Bodys in finishCall (eigene Funktion, aus
// sendSummaryMails herausgezogen, um dessen Verzweigungszahl unter der Grenze zu halten -
// reine Verschiebung, kein Verhaltenswechsel).
function buildMailBody({ call, t, who, result, aiCount }) {
  const when = mailTimestampLabel(call);
  const durationLabel = formatCallDuration(call);
  return (
    `${who}\n\n` +
    (when ? `${t.mailTimeLabel} ${when}\n` : "") +
    (durationLabel ? `${t.mailDurationLabel} ${durationLabel}\n` : "") +
    `\n${result.summary}` +
    (aiCount
      ? `\n\n${t.actionItemsHeading}\n` + result.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n")
      : "")
  );
}

// F2-Newsletter-Recipients: mailPlan.targets buendelt die Konto-Adresse (Boolean-Consent,
// unsubToken=null) UND alle CONFIRMED Zusatzempfaenger (unsubToken gesetzt) - beide Achsen
// sind orthogonal (mail-summary.js). NUR Zusatzadressen bekommen den Abmelde-Link-Footer
// (Owner-Auftrag: "Abmelde-Link in jeder Mail an Zusatzadressen") - die Konto-Adresse
// widerruft weiterhin ueber den Boolean-Consent-Weg, nicht ueber diesen Kanal. Liefert die
// Zahl ERFOLGREICHER Sends zurueck (Teilfehler werden geloggt, aber NICHT gezielt
// nachversendet - bewusste Vereinfachung, Auftrag). Eigene Funktion (aus sendSummaryMails
// herausgezogen), um dessen Verzweigungszahl unter der Grenze zu halten.
async function sendMailToTargets({ config, mailer, targets, mailBody, t }) {
  let sentCount = 0;
  for (const target of targets) {
    const mailText = target.unsubToken
      ? `${mailBody}\n\n${t.unsubscribeLinkLabel} ` +
        newsletterUnsubscribeUrl(config.server.publicUrl, target.unsubToken)
      : mailBody;
    try {
      await mailer.sendMail({ to: target.email, subject: t.summaryTitle, text: mailText });
      sentCount += 1;
    } catch (e) {
      console.error("[mail]", e.message);
    }
  }
  return sentCount;
}

// F2-Mail: Call-Summary per E-Mail bei Newsletter-Einwilligung (Auftrag), Spiegel des
// SMS-Blocks in finishCall. Gate-Entscheidung in planSummaryMail (mail-summary.js, inkl.
// dem EINEN async Schritt - accounts.accountByTenant); der Mail-Text baut buildMailBody,
// der Versand sendMailToTargets (Muster SMS: sms-summary.js liest nur, den Body baut der
// Aufrufer). Eigene Funktion (aus finishCall herausgezogen), damit finishCall unter der
// Zeilengrenze bleibt - reine Verschiebung, kein Verhaltenswechsel.
async function sendSummaryMails({ store, config, call, mailer, accounts, audit, t, who, result, aiCount }) {
  const mailPlan = await planSummaryMail({ store, call, mailer, accounts });
  if (!mailPlan.send) {
    if (mailPlan.reason) {
      // Kein Mailer/keine Konto-E-Mail -> Mail still uebersprungen, kein Throw (Muster SMS).
      // Audit nur Marker + Reason, NIE die E-Mail-Adresse (Regel 4/H4).
      audit("mail_summary_skipped", null, `call=${call.id} reason=${mailPlan.reason}`);
    }
    return;
  }
  const mailBody = buildMailBody({ call, t, who, result, aiCount });
  const sentCount = await sendMailToTargets({ config, mailer, targets: mailPlan.targets, mailBody, t });
  // NUR nach MINDESTENS EINEM erfolgreichen Send (Muster markSummarySmsSent) - bleiben
  // ALLE Versuche erfolglos, KEIN Marker -> ein spaeterer Retry (naechster /voice/status)
  // versucht die Mail(s) erneut statt sie fuer immer zu verlieren.
  if (sentCount > 0) store.markSummaryMailSent(call.id);
}

export function makeCallFinish({
  store,
  config,
  metering,
  messaging,
  summarizeCall,
  planSummarySms,
  audit,
  mailer = null,
  accountsRef = { current: null },
  // INBOX-P1: die Inbox-Regel kommt HEREIN (DIP) - sie lebt in inbox-entry.js und haengt
  // ueber die geteilte Substanz-Primitive an claude.js/config.js. Diese Datei bekommt
  // summarizeCall aus genau demselben Grund injiziert (offline testbar, kein Boot beim
  // Import). Default wie mailer/accountsRef: OHNE Verdrahtung entsteht KEIN Eintrag
  // (fail-closed) und Bestands-Attrappen bleiben gueltig; dass server.js die echte Regel
  // hereinreicht, pinnt test/inbox-entry-qualification.test.js.
  qualifiesAsInboxEntry = () => false,
}) {
  // OUT-05 (F2): Worst-Case-Reserve eines Calls freigeben (idempotent ueber call.reserveReleased,
  // state-ops). FEHLER-SCHLUCKEND: KEIN Freigabepfad (catch/finishCall/Backstop) darf je einen
  // unhandled reject werfen; ein IO-Fehler ist secret-frei geloggt (err.message) und sonst
  // folgenlos (die Reserve ist ephemer, faellt spaetestens beim Boot auf 0). Liefert ein Promise.
  function releaseReserve(call) {
    return store
      .withStoreLock(() => store.releaseOutboundReserve(call))
      .catch((e) => console.error("[reserve] release:", e.message));
  }

  // ---------------- Call zu Ende -> Summary + Notification + SMS ----------------
  // Idempotent: kann von Status-Callback, Bridge und cancel_call gleichzeitig angestossen werden.
  async function finishCall(call) {
    if (!call || call._finished) return;
    call._finished = true;
    // WEB-14: die Rahmentexte folgen der Sprache des Calls (dieselbe Aufloesung wie im
    // Anrufpfad, localeFor). DE byte-identisch.
    const t = localeFor(call.language).postCall;
    // F9 (A6): Abrechnung genau EINMAL ueber Prozessgrenzen. Der persistierte billedAt-Marker
    // (ueberlebt Restart, anders als _finished) gated NUR den Abrechnungsblock; Summary/
    // Notification bleiben retry-bar, SMS bleibt ueber summarySmsSentAt idempotent (R-8.5).
    if (!call.billedAt) {
      // Voice-Minuten metern, BEVOR der Nicht-completed-Pfad early-returnt: auch ein
      // beantworteter, aber nicht zusammengefasster Call hat abrechenbare Minuten.
      if (config.billing.paymentEnabled) metering.recordVoiceMinuteMeter(call);
      metering.reconcileVoiceBudget(call); // KV-P2: Carrier-Minuten BEIDER Richtungen in den Budget-Bucket, IMMER
      store.markBilled(call.id); // -> billed_at persistiert, ueberlebt Restart (F9)
    }
    await releaseReserve(call); // OUT-05 (F2): Worst-Case-Reserve abbauen; Ist-Minuten bleiben in costCents
    store.save();

    if (call.status !== "completed" || !call.transcript.length) {
      const target = call.direction === "outbound" ? call.to : call.from;
      // GQ-P15 (F4): die EINZIGE passive Nachricht nennt jetzt auch den GRUND, wenn einer
      // gespeichert ist. Der Grund steht bereits am Record, bevor finishCall den Call sieht:
      // /voice/status ruft recordFailureReason VOR terminateAndBillCall, der Cap-/Budget-Pfad
      // schreibt ihn gemeinsam mit dem Endzustand, und billThunk laedt den Call frisch aus dem
      // Store. Weitergereicht wird ausschliesslich das bereits gefilterte, PII-freie Token
      // (callFailureReason bzw. CAP_/BUDGET_FAILURE_REASON) - kein Provider-Rohtext. Ohne
      // Grund bleibt der Text byte-identisch zum Bestand.
      store.addNotification(
        call.status === "cancelled" ? t.cancelledTitle : t.failedTitle,
        t.statusBody(target, call.status, call.failureReason),
        call.id,
      );
      return;
    }

    // INBOX-P1: die Qualifikation faellt im Anrufmoment - VOR summarizeCall (der Purge
    // unten loescht das Transkript, das der Beleg IST) und VOR jedem Fehlerpfad. Rein,
    // kein Nebeneffekt; die Regel selbst lebt in inbox-entry.js (EINE Quelle).
    const inboxWorthy = qualifiesAsInboxEntry(call, store.tenantContext(call.tenantId).settings);
    try {
      // EL-Anrufstart: auf dem ElevenLabs-Weg fuehrt der Agent des ANBIETERS das Gespraech
      // und liefert die Zusammenfassung mit; sie steht bereits am Record, bevor
      // finishCall den Call sieht (elevenlabs/outbound.js). Ein eigener LLM-Roundtrip
      // waere dann eine zweite, schlechtere Wahrheit ueber dasselbe Gespraech - und Token
      // fuer Arbeit, die schon bezahlt ist. Auf JEDEM anderen Weg ist call.summary hier
      // leer (sie entsteht erst IN summarizeCall) -> Bestandsverhalten unveraendert.
      const result = call.summary
        ? { summary: call.summary, actionItems: storedActionItemTexts(store, call.id) }
        : await summarizeCall(call);
      // Roh-Transkript-Purge (#7, DSGVO-Datenminimierung). P2b: der Purge steht jetzt VOR
      // dem Frueh-Return. Ein leeres `result` heisst hier NICHT "Fehler" - ein Fehler
      // WIRFT und landet im catch unten, und ein leeres Transkript ist oben bereits
      // rausgefallen. Es heisst genau eins: fuer diesen Tenant sind Summaries
      // abgeschaltet (allowSummaries=false, claude.js). Vorher lief der Purge erst
      // DANACH - wer Summaries abschaltete, bekam still die LAENGSTE Aufbewahrung
      // (Roh-Transkript bis RETENTION_DAYS) statt der kuerzesten. Genau verkehrt herum.
      // Einzige Ausnahme ist die Diagnose-Retention (Ziel == eigene verifizierte Nummer
      // des Tenants); die raeumt pruneOldData nach DIAGNOSTIC_RETENTION_DAYS ab.
      // Unveraendert: scheitert die Summary mit einer Exception, bleibt das Transkript
      // liegen -> pruneOldData als Defense-in-Depth.
      if (!keepsTranscriptForDiagnosis(call, config.privacy)) store.purgeTranscript(call.id);
      if (!result) return;
      const aiCount = (result.actionItems || []).length;
      const who = call.direction === "outbound" ? t.subjectOutbound(call.to) : t.subjectInbound(call.from);
      store.addNotification(t.summaryTitle, `${who}: ${result.summary}`, call.id);

      // F2 P7: Ziel + Sende-Entscheidung in planSummarySms ausgelagert (offline testbar -
      // server.js bootet beim Import). Ziel ist die PRIVATE Nummer des Call-Tenants (ueber
      // call.tenantId, identischer Schluessel wie der Absender -> keine Cross-Tenant-Fehl-
      // zustellung, H3), NICHT mehr config.ownerNumber (kein Fallback im finishCall-Pfad,
      // AK #5). Der Guard prueft Ziel + Absender + Opt-Out VOR jedem String-Bau, damit ein
      // fehlendes Ziel die .slice-Operation nie crasht (M4). settings.agentName fuer den
      // Body kommt aus derselben in-memory tenantContext-Quelle.
      const plan = planSummarySms(store, config, call);
      if (plan.send) {
        // AL-P11: in der SMS steht zuerst das ERGEBNIS, nicht die Umschreibung.
        // call.result.outcome ist der normalisierte Ein-Satz-Befund (call-result.js);
        // fehlt er (Modell ohne Karte, Alt-Call), bleibt die Summary der Bestandstext.
        const resultLine = call.result?.outcome || result.summary;
        const sms =
          `[${store.tenantContext(call.tenantId).settings.agentName}] ${who}\n\n${resultLine}` +
          (aiCount
            ? `\n\n${t.actionItemsHeading}\n` + result.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n")
            : "");
        try {
          await messaging(call.provider).sendSms({
            from: plan.smsFrom.e164,
            to: plan.to,
            body: sms.slice(0, SMS_BODY_MAX_CHARS),
          });
          // F2 P8 (H1): Kosten-Beleg + Quelle des Tages-Cap-Zaehlers (dailySmsCount). NUR
          // nach ERFOLGREICHEM Send - schlaegt sendSms fehl, springt der catch an, es wird
          // KEIN Event geschrieben -> der Cap zaehlt nur real gesendete SMS (AK #3). grobe
          // Kosten aus dem benannten Tarif (config.billing.smsCostCents); NIE die Zielnummer (PII).
          // KV-P1: diese Buchung ist die Zeile sms der Kosten-Landkarte
          // (src/billing/cost-ledger-map.js).
          store.recordUsageEvent({
            tenantId: call.tenantId,
            callId: call.id,
            kind: USAGE_EVENT_KIND.SMS,
            quantity: 1,
            costCents: config.billing.smsCostCents,
          });
          // F2 P9 (M2): persistierten Dedup-Marker setzen - NUR nach erfolgreichem Send.
          // Ueberlebt den Prozess-Restart und unterdrueckt eine zweite Summary-SMS bei einem
          // spaeten /voice/status-Retry (planSummarySms prueft summarySmsSentAt). Bewusst
          // NACH recordUsageEvent: der Marker steht erst, wenn die SMS real raus ist.
          store.markSummarySmsSent(call.id);
        } catch (e) {
          console.error(
            "[sms]",
            e.message,
            "(Trial: Zielnummer verifiziert? SMS-faehige Twilio-Nummer?)",
          );
        }
      } else if (plan.reason) {
        // Kein Ziel -> SMS still uebersprungen. Notification (oben) bleibt, kein Throw (M4).
        // Audit nur Marker + Reason, NIE die Nummer (H4); req=null -> ip=system.
        audit("sms_summary_skipped", null, `call=${call.id} reason=${plan.reason}`);
      }

      // F2-Mail: aiCount/who sind bereits oben berechnet (G5: EINE Quelle fuer beide
      // Kanaele - SMS und Mail). Der eigentliche Mail-Bau + Versand steht in
      // sendSummaryMails (Modul-Top, reine Verschiebung fuer die Funktionslaenge).
      await sendSummaryMails({
        store,
        config,
        call,
        mailer,
        accounts: accountsRef.current,
        audit,
        t,
        who,
        result,
        aiCount,
      });
    } catch (err) {
      console.error("[summary]", err.message);
    } finally {
      // Laeuft auch nach der Exception oben UND nach dem fruehen Return im Purge-Pfad.
      // Ohne das luegt die Leer-Antwort der Inbox bei jedem LLM-Ausfall. No-op bei false.
      store.markInboxEntry(call.id, inboxWorthy);
    }
  }

  return { finishCall, releaseReserve };
}
