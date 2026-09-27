// GQ-P15 (Fragilitaets-Befund F4): der bereits gespeicherte, PII-freie Ausfall-GRUND wird in
// der passiven Benachrichtigung lesbar. Der Grund liegt seit CDF1/GAP-26/KS-P1b als TOKEN am
// Call (call.failureReason); hier bekommt genau dieses Token pro Sprache einen lesbaren
// Satzteil. Es wird KEIN neuer Rohwert erhoben - callFailureReason liefert ein Token, und
// diagnostics.sipHangupCause laeuft ausdruecklich durch safeCauseToken.
//
// GETRENNT von den gesprochenen Locale-Strings (Muster MCP_TEXTS/GATE_TEXTS): dieser Text
// wird NIE gesprochen, sondern als Notification-Text ausgeliefert - die deutschen Werte
// bleiben deshalb in der ASCII-Transliteration des Bestands (Repo-Konvention).
// FR traegt Akzente, EN ist kuratiert.
//
// SCHLUESSEL = Basis-Token (alles vor dem Detail-Trenner, s. failureReasonBase): "failed:603"
// wird ueber "failed" beschrieben, der SIP-Detailwert bekommt bewusst KEINEN Nutzertext.
// Ein UNBEKANNTES Token hat hier keinen Eintrag -> makeStatusBody faellt auf den heutigen
// Wortlaut zurueck; ein Roh-Token erreicht den Nutzer NIE (Absolute Regel PII).
//
// Die sieben Provider-Token stammen aus telephony/failure-reason.js (FAILURE_REASON_BASE_TOKENS),
// die beiden internen aus
// telephony/call-lifecycle.js (CAP_FAILURE_REASON/BUDGET_FAILURE_REASON). Bewusst als
// Literale statt als Import: das Sprachbuendel darf nicht von der Telefonie-Orchestrierung
// (und damit transitiv von config.js) abhaengen. Gegen Drift sichert der Vollstaendigkeits-
// Test in test/gq-p15-failure-reason-notification.test.js, der die ECHTEN Konstanten
// importiert und die echte Token-Erzeugung durchfaehrt.
import { failureReasonBase } from "../telephony/failure-reason.js";

export const FAILURE_REASON_TEXTS = Object.freeze({
  de: Object.freeze({
    reasonLabel: "Grund:",
    phrases: Object.freeze({
      "no-answer": "niemand hat abgenommen",
      "busy": "die Leitung war besetzt",
      "canceled": "der Anruf wurde vor dem Abheben abgebrochen",
      "failed": "die Verbindung kam nicht zustande",
      "not-placed": "der Anruf konnte auf unserer Seite nicht aufgebaut werden",
      "unreachable": "der Anschluss war nicht erreichbar",
      "result-unknown": "der Ausgang des Anrufs ist unbekannt",
      "max-duration-cap": "die maximale Gespraechsdauer war erreicht",
      "budget-exhausted": "das Budget war aufgebraucht",
    }),
  }),
  fr: Object.freeze({
    reasonLabel: "motif :",
    phrases: Object.freeze({
      "no-answer": "personne n'a décroché",
      "busy": "la ligne était occupée",
      "canceled": "l'appel a été annulé avant le décrochage",
      "failed": "la connexion n'a pas pu être établie",
      "not-placed": "l'appel n'a pas pu être établi de notre côté",
      "unreachable": "le numéro n'était pas joignable",
      "result-unknown": "l'issue de l'appel est inconnue",
      "max-duration-cap": "la durée maximale d'appel était atteinte",
      "budget-exhausted": "le budget était épuisé",
    }),
  }),
  en: Object.freeze({
    reasonLabel: "reason:",
    phrases: Object.freeze({
      "no-answer": "nobody picked up",
      "busy": "the line was busy",
      "canceled": "the call was cancelled before it was answered",
      "failed": "the connection could not be established",
      "not-placed": "the call could not be placed on our side",
      "unreachable": "the number could not be reached",
      "result-unknown": "the outcome of the call is unknown",
      "max-duration-cap": "the maximum call duration was reached",
      "budget-exhausted": "the budget was used up",
    }),
  }),
});

// OUTBOUND-E3a (G5): die Aufloesung Token -> Satz lebt ab hier an GENAU EINER Stelle.
// Vorher stand sie inline in makeStatusBody; mit dem MCP-Rueckweg als zweitem Leser waere
// daraus eine zweite Herleitung geworden - genau das, was E3a verbietet.
// Object.hasOwn statt phrases[base] ist PFLICHT, kein Stil: das Token kommt aus
// Provider-Daten, und ein Token wie "constructor" lieferte ueber die Prototypen-Kette
// eine Funktion in den Nutzertext.
// Unbekanntes/neues Basis-Token -> null (der Aufrufer entscheidet seinen Rueckfall).
export function makeFailureSentence({ phrases }) {
  return (failureReason) => {
    const base = failureReasonBase(failureReason);
    return base && Object.hasOwn(phrases, base) ? phrases[base] : null;
  };
}

// EINE Quelle (G5) fuer die drei statusBody-Lambdas des Locale-Bundles. Ausgabe
// BYTE-IDENTISCH zum Bestand: ohne bekannten Grund `${target} (${statusLabel} ${status})`,
// mit Grund derselbe Text plus ", <reasonLabel> <Grund>".
export function makeStatusBody(statusLabel, bundle) {
  const sentence = makeFailureSentence(bundle);
  return (target, status, failureReason) => {
    const statusPart = `${statusLabel} ${status}`;
    const phrase = sentence(failureReason);
    return phrase
      ? `${target} (${statusPart}, ${bundle.reasonLabel} ${phrase})`
      : `${target} (${statusPart})`;
  };
}

// OUTBOUND-E3a: der Ergebnistext des MCP-Rueckwegs (await_call_event/get_call_result).
// Anders als statusBody hat er KEIN Ziel-Feld - deshalb ein eigener Bauplan, aber
// DIESELBE Aufloesung (makeFailureSentence). Drei Ausgaenge, bewusst getrennt:
//   kein Grund          -> null  (der Aufrufer behaelt seinen Bestandstext; die
//                                 Gegenrichtung ist per Test gepinnt)
//   bekannter Grund     -> "<Lead> <reasonLabel> <Satzteil>"
//   unbekanntes Token   -> "<Lead>" allein (Befund D-5: ein rohes Token darf den Nutzer
//                          NIE erreichen; der Sammel-Satz ist verstaendlich und wahr, das
//                          Token bleibt der Diagnose vorbehalten - Store und Log. Seit P5b
//                          (O-13 Teil 2) gilt das auch fuer das Maschinenfeld
//                          failure_reason: es traegt seit dieser Phase nur noch das
//                          Basis-Token, nicht mehr das volle Detail).
export function makeCallFailedSummary(lead, bundle) {
  const sentence = makeFailureSentence(bundle);
  return (failureReason) => {
    if (!failureReason) return null;
    const phrase = sentence(failureReason);
    return phrase ? `${lead} ${bundle.reasonLabel} ${phrase}` : lead;
  };
}
