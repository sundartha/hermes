// CDF1 (Report #2 5.4): maschinenlesbarer, PII-freier Fehlergrund aus dem normalisierten
// Provider-Lifecycle ({status, diagnostics} aus extractLifecycleEvent). Provider-agnostisch:
// Telnyx UND Twilio senden dieselbe CallStatus-Vokabel; der SIP-Cause verfeinert NUR den
// generischen "failed"-Fall. PII-frei by construction (nur Status-/Cause-Token, NIE Nummern/
// Namen - diagnostics.sipHangupCause ist bereits ueber safeCauseToken gefiltert).

// Erfolgs-/Selbstsprechende Status (Domaenen-Vokabel, identisch zur /voice/status-Terminalliste).
const COMPLETED_STATUS = "completed";
// Status, die schon selbst den Grund tragen -> 1:1 als Token (Status gewinnt vor SIP-Cause,
// vgl. Spec-Beispiel: no-answer + sipHangupCause=487 -> "no-answer").
const SELF_DESCRIBING_FAILURES = ["no-answer", "busy", "canceled"];
const GENERIC_FAILURE_STATUS = "failed";

// Liefert ein stabiles, kleines Token (string) ODER null (Erfolg/aktiv/leer -> KEIN Grund).
// Form: "no-answer" | "busy" | "canceled" | "failed:<sipcause>" | "failed" | <roher status>.
export function callFailureReason({ status, diagnostics } = {}) {
  if (!status || status === COMPLETED_STATUS) return null;
  if (SELF_DESCRIBING_FAILURES.includes(status)) return status;
  if (status === GENERIC_FAILURE_STATUS) {
    const sip = diagnostics?.sipHangupCause;
    return sip ? `${GENERIC_FAILURE_STATUS}:${sip}` : GENERIC_FAILURE_STATUS;
  }
  return status; // unbekannter Nicht-completed-Status -> defensiver Passthrough, kein Bruch
}
