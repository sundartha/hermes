// Szenario "friseur-voll" (Spec §9): outbound, Per-Call-Kontext AKTIV. Stammkunde bei
// "Friseur Schneider" will den naechsten freien Termin bei Petra fuer einen
// Herrenhaarschnitt, bevorzugt vormittags. Persona = Empfangsmitarbeiterin, die einen
// Vormittags-Slot anbietet und am Ende eine konkrete Buchung bestaetigt (Realitaets-
// Pruefung fuer booked_with_nongeneric_title).
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
    "wenn nach einem Termin gefragt wird, und bestaetige eine finale Buchung freundlich und knapp.",
  scriptedTurns: {},
  sttNoise: false,
  maxTurns: 8,
  expectBooking: true,
  expectDegradation: false,
  checks: [
    "disclosure_first",
    "no_redundant_ask_about_briefed_info",
    "booked_with_nongeneric_title",
    "farewell_before_terminal",
    "turn_count_within_budget",
  ],
  mustNotAskSubstrings: ["welchen service", "was fuer einen termin"],
  judgeFocus: null,
};
