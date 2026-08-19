// CDF1 (Report #2 5.4): maschinenlesbarer, PII-freier Fehlergrund aus dem normalisierten
// Provider-Lifecycle ({status, diagnostics} aus extractLifecycleEvent). Provider-agnostisch:
// die CallStatus-Vokabel ist Twilio-Konvention, die Telnyx' TeXML spiegelt; der SIP-Cause
// verfeinert NUR den
// generischen "failed"-Fall. PII-frei by construction (nur Status-/Cause-Token, NIE Nummern/
// Namen - diagnostics.sipHangupCause ist bereits ueber safeCauseToken gefiltert).

// Erfolgs-/Selbstsprechende Status (Domaenen-Vokabel, identisch zur /voice/status-Terminalliste).
// Exportiert (G22, Nachfassrunde): telnyx-call-control-ingest.js braucht denselben Token fuer
// den gespeicherten Call-Status - EIN Wort an EINER Stelle statt zweimal woertlich getippt.
export const COMPLETED_STATUS = "completed";
// Status, die schon selbst den Grund tragen -> 1:1 als Token (Status gewinnt vor SIP-Cause,
// vgl. Spec-Beispiel: no-answer + sipHangupCause=487 -> "no-answer").
const SELF_DESCRIBING_FAILURES = ["no-answer", "busy", "canceled"];
const GENERIC_FAILURE_STATUS = "failed";
// Trenner zwischen Basis-Token und Detail ("failed:603"). EINE Quelle fuer den Erzeuger
// (callFailureReason) und den Leser (failureReasonBase) - vorher stand er nur als Literal
// im Template und musste vom Leser erraten werden.
const DETAIL_SEPARATOR = ":";

// Liefert ein stabiles, kleines Token (string) ODER null (Erfolg/aktiv/leer -> KEIN Grund).
// Form: "no-answer" | "busy" | "canceled" | "failed:<sipcause>" | "failed" | <roher status>.
export function callFailureReason({ status, diagnostics } = {}) {
  if (!status || status === COMPLETED_STATUS) return null;
  if (SELF_DESCRIBING_FAILURES.includes(status)) return status;
  if (status === GENERIC_FAILURE_STATUS) {
    const sip = diagnostics?.sipHangupCause;
    return sip ? `${GENERIC_FAILURE_STATUS}${DETAIL_SEPARATOR}${sip}` : GENERIC_FAILURE_STATUS;
  }
  return status; // unbekannter Nicht-completed-Status -> defensiver Passthrough, kein Bruch
}

// Basis-Token eines Grundes: "failed:603" -> "failed", "no-answer" -> "no-answer",
// null/leer -> null. Der Detail-Teil (SIP-Cause) verfeinert nur die Diagnose und hat
// bewusst keinen eigenen Nutzertext. Rein, ohne Nebeneffekt.
export function failureReasonBase(reason) {
  return reason ? String(reason).split(DETAIL_SEPARATOR)[0] : null;
}

// Befund 5: TeXML liefert mit CallStatus bereits die vorklassifizierte Status-Vokabel
// (completed/busy/no-answer/canceled/failed); Telnyx' Call-Control-Pfad liefert dagegen NUR
// den rohen hangup_cause. Diese Tabelle uebernimmt fuer den Call-Control-Pfad genau die
// Klassifikation, die bei TeXML bereits Telnyx selbst vornimmt - damit callFailureReason()
// oben UNVERAENDERT wiederverwendet werden kann (G5: ein Reason-Vokabular fuer beide Pfade).
//
// Quellen je Kennung (Pflicht CLAUDE.md - "Erfinde keine"):
// - "timeout" -> no-answer: developers.telnyx.com/api-reference/call-commands/transfer-call
//   ("hangup_cause of timeout" bei nicht erreichter Annahme) UND LIVE-Beleg
//   tasks/befund-toolwahl-4-forensik.md Zeile 91f (hangup_cause=timeout sip_hangup_cause=487
//   = kein Antworten beim Ziel).
// - "user_busy" -> busy: Telnyx-Support-Artikel 5025298 ("Troubleshooting Call Completion"),
//   dort USER_BUSY(17) "the called party is currently engaged in another call".
// - "originator_cancel" -> canceled: KEIN eigenstaendiger Telnyx-Doku-Beleg gefunden (nur
//   die allgemeine Q.850/FreeSWITCH-Ursachenfamilie, der auch die zwei bestaetigten Werte
//   oben folgen). Quelle ist hier ausschliesslich die Testspezifikation (Fall 3) - im
//   Bericht als offene Luecke benannt.
const HANGUP_CAUSE_STATUS = Object.freeze({
  timeout: "no-answer",
  user_busy: "busy",
  originator_cancel: "canceled",
});

// Nachfassrunde (Blocker A, G26): "kein answered_at" darf NIE zwischen null und dem Feld-
// Fehlen (undefined) unterscheiden - genau diese Sorte Invariante hat das Repo schon einmal
// teuer bezahlt (Owner-Zitat). hangupCauseStatus prueft darum answeredAt nie auf Gleichheit
// mit null, sondern ausschliesslich auf TRUTHINESS: ein echter ISO-String ist truthy, sowohl
// null ALS AUCH undefined (und jeder andere leere Wert) sind falsy und nehmen denselben Zweig
// - kein Aufrufer kann diese Weiche durch Auslassen des Feldes umgehen, weder heute noch bei
// einem kuenftigen zweiten Provider-Adapter.

// Nachfassrunde (Blocker B, Gegner-Review): "kein answered_at" ist ein FEHLENDER Beleg,
// kein Beweis - call.answered und call.hangup sind getrennte Webhook-Requests ohne Ordnungs-
// /Wiederholungsgarantie (der Anbieter kann den ersten verlieren oder verspaetet liefern).
// Meldet Telnyx TROTZDEM eine Ursache, die nur bei einem zustandegekommenen Gespraech
// entsteht, WIDERSPRICHT das dem fehlenden Zeitstempel - und der Zweifel geht NICHT zulasten
// des Mandanten (sonst: falsche Fehlschlag-SMS UND 0 gebuchte Minuten, ein Geld-Defekt, der
// schwerer wiegt als der Ausgangsbefund). Belegte Kennung: "normal_clearing" (Fall 4/8 der
// Pruefung, LIVE-Beleg tasks/gq-chain-state.md Zeile 1288 - ein sauberer, beidseitig normaler
// Gespraechsabschluss). Bewusst ALS BENANNTE MENGE (nicht verstreut im if): weitere belegte
// "die Leitung stand"-Kennungen kommen hier dazu, nicht als zusaetzliche Bedingung irgendwo.
const LINE_WAS_UP_CAUSES = new Set(["normal_clearing"]);

// Normalisiert Telnyx' Call-Control-hangup_cause + answeredAt auf dieselbe Status-Vokabel wie
// TeXML's CallStatus. Reihenfolge ist eine Aussage:
//   1. echt beantwortet (answeredAt truthy)            -> completed, IMMER (Gegenprobe Fall 4)
//   2. kein Zeitstempel, aber ein Beleg fuer "Leitung stand" (LINE_WAS_UP_CAUSES) -> completed,
//      der Widerspruch wird NICHT zulasten des Mandanten aufgeloest (Fall 8, Blocker B)
//   3. kein Zeitstempel, bekannte Nichtannahme-Ursache -> praeziser Grund (no-answer/busy/
//      canceled, Faelle 1-3/7)
//   4. kein Zeitstempel, Ursache unbekannt/fehlt        -> ehrlicher genereller Rueckfall,
//      roher Anbieter-Token reist mit wenn vorhanden (Faelle 5/6) - "Erfinde keine" gilt fuer
//      die ZUORDNUNG (kein geratenes no-answer/busy/canceled), nicht fuer den generischen
//      Status selbst. Der defensive Passthrough in callFailureReason() oben ("unbekannter
//      Nicht-completed-Status") gibt diesen Status 1:1 als lesbaren Grund zurueck.
export function hangupCauseStatus({ answeredAt, hangupCause } = {}) {
  if (answeredAt) return COMPLETED_STATUS;
  if (LINE_WAS_UP_CAUSES.has(hangupCause)) return COMPLETED_STATUS;
  if (HANGUP_CAUSE_STATUS[hangupCause]) return HANGUP_CAUSE_STATUS[hangupCause];
  if (!hangupCause) return GENERIC_FAILURE_STATUS;
  return `${GENERIC_FAILURE_STATUS}${DETAIL_SEPARATOR}${hangupCause}`;
}
