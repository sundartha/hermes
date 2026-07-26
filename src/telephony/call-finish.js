// Call-Finish: Settlement + Summary + Notification + SMS (finishCall) und die
// Worst-Case-Reserve-Freigabe (releaseReserve). Reine Verschiebung aus server.js
// (Server-Slim P4). Die Factory schliesst store/config/metering/messaging/summarizeCall/
// planSummarySms/audit; USAGE_EVENT_KIND importiert das Modul selbst (EINE Quelle, G5).
// EINE Instanz je Prozess (Wurzel-Scope, INV-7): dieselbe finishCall-Referenz geht an
// attachMediaBridge UND makeCallControlIngest - die In-Memory-Guards (call._finished) und
// der persistierte billedAt-Marker verlangen Identitaet. Die paymentEnabled-Gating-Bedingung
// (Voice-Minuten-Meter) bleibt im finishCall-Body (INV-9); reconcileOutboundVoiceBudget
// laeuft immer, releaseReserve wird intra-modul aufgerufen. P2b: die injizierte config
// schliesst zusaetzlich config.privacy (Diagnose-Retention-Frist) - dieselbe Rolle wie
// config.billing fuer das Metering, nur fuer den Roh-Transkript-Purge-Entscheid.
import { USAGE_EVENT_KIND } from "../store/defaults.js";
import { keepsTranscriptForDiagnosis } from "../diagnostic-retention.js";
import { localeFor } from "../i18n/locales.js";

// Provider-SMS-Segmentgrenze (Zusammenfassungs-SMS wird hierauf gekuerzt).
const SMS_BODY_MAX_CHARS = 1500;

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
      metering.reconcileOutboundVoiceBudget(call); // outbound-p1c: Carrier-Minuten in den Budget-Bucket (D1), IMMER
      store.markBilled(call.id); // -> billed_at persistiert, ueberlebt Restart (F9)
    }
    await releaseReserve(call); // OUT-05 (F2): Worst-Case-Reserve abbauen; Ist-Minuten bleiben in costCents
    store.save();

    if (call.status !== "completed" || !call.transcript.length) {
      const target = call.direction === "outbound" ? call.to : call.from;
      store.addNotification(
        call.status === "cancelled" ? t.cancelledTitle : t.failedTitle,
        t.statusBody(target, call.status),
        call.id,
      );
      return;
    }

    try {
      const result = await summarizeCall(call);
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
        const sms =
          `[${store.tenantContext(call.tenantId).settings.agentName}] ${who}\n\n${result.summary}` +
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
