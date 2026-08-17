// Call-Finish: Settlement + Summary + Notification + SMS (finishCall) und die
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
import { USAGE_EVENT_KIND } from "../store/defaults.js";
import { keepsTranscriptForDiagnosis } from "../diagnostic-retention.js";
import { localeFor } from "../i18n/locales.js";

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

export function makeCallFinish({
  store,
  config,
  metering,
  messaging,
  summarizeCall,
  planSummarySms,
  audit,
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
    } catch (err) {
      console.error("[summary]", err.message);
    }
  }

  return { finishCall, releaseReserve };
}
