// Szenario "friseur-voll": outbound, Per-Call-Kontext AKTIV. Stammkunde bei "Friseur
// Schneider" will den naechsten freien Termin bei Petra fuer einen Herrenhaarschnitt,
// bevorzugt vormittags. Persona = Empfangsmitarbeiterin, die einen Vormittags-Slot
// anbietet.
// P4/P1b: Der Agent BUCHT nicht mehr (book_appointment existiert nicht mehr). Die
// Erfolgsdefinition ist deshalb umgestellt - nicht "gebucht", sondern: den Terminwunsch
// sauber als Nachricht fuer den Besitzer abliefern (message_taken) statt scheinzubuchen.
import { MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "friseur-voll",
  direction: "outbound",
  assistantContextEnabled: true,
  goal: "Naechsten freien Termin fuer einen Herrenhaarschnitt vereinbaren",
  briefing: "Stammkunde bei Friseur Schneider, moechte wie immer zu Petra, bevorzugt vormittags",
  constraints: null,
  context: {
    summary: "Anruf beim Stammfriseur zur Terminvereinbarung fuer einen Herrenhaarschnitt",
    key_facts: ["Stammkunde seit 2 Jahren", "bevorzugt Petra"],
    desired_outcome: "Termin fest gebucht",
  },
  personaPrompt:
    "Du bist die Empfangsmitarbeiterin bei 'Friseur Schneider'. Ein Anrufer moechte einen " +
    "Termin bei Petra fuer einen Herrenhaarschnitt, bevorzugt vormittags. Du hast am Dienstag " +
    "10:30 Uhr und Donnerstag 9:00 Uhr bei Petra frei. Antworte in GENAU 1 kurzem gesprochenen " +
    "Satz, KEIN Meta-Kommentar, keine Regieanweisungen. Biete proaktiv einen freien Slot an, " +
    "wenn nach einem Termin gefragt wird, und bestaetige eine getroffene Terminabsprache " +
    "freundlich und knapp.",
  scriptedTurns: {},
  sttNoise: false,
  maxTurns: 8,
  expectDegradation: false,
  // AL-P8: recap_present - hat der Agent vor Abschluss zusammengefasst, was er fuer
  // den Besitzer festhaelt? Gefaltete Wendungen (Muster mustNotPromiseSubstrings).
  recapSubstrings: ["ich notiere", "ich habe notiert", "ich gebe das weiter", "richte ich aus", "sage ich bescheid"],
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "no_redundant_ask_about_briefed_info",
    "message_taken",
    "farewell_before_terminal",
    "turn_count_within_budget",
    "no_transliterated_umlauts_de",
    "recap_present",
  ],
  mustNotAskSubstrings: ["welchen service", "was fuer einen termin"],
  judgeFocus: null,
};
