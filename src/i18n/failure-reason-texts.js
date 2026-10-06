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

export function makeFailureSentence({ phrases }) {
  return (failureReason) => {
    const base = failureReasonBase(failureReason);
    return base && Object.hasOwn(phrases, base) ? phrases[base] : null;
  };
}

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

export function makeCallFailedSummary(lead, bundle) {
  const sentence = makeFailureSentence(bundle);
  return (failureReason) => {
    if (!failureReason) return null;
    const phrase = sentence(failureReason);
    return phrase ? `${lead} ${bundle.reasonLabel} ${phrase}` : lead;
  };
}
