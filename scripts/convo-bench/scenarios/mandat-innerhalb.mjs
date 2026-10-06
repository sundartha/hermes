import { BENCH_MAX_OPENING_CHARS, MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "mandat-innerhalb",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Einen Termin fuer die Jahresinspektion vereinbaren",
  briefing: null,
  constraints: null,
  context: null,
  mandate: {
    decide_freely: "Termin an einem Montag, Dienstag oder Mittwoch zwischen 13 und 17 Uhr, bis 60 Euro",
    fallback_order: "zuerst Dienstag, sonst Mittwoch, sonst Montag",
    on_out_of_scope: "take_message",
  },
  personaPrompt:
    "Du bist die Empfangsmitarbeiterin einer Kfz-Werkstatt. Ein Anrufer moechte einen " +
    "Termin fuer die Jahresinspektion. Du hast Dienstag 14:00 Uhr frei, das kostet 55 Euro. " +
    "Antworte in GENAU 1 kurzem gesprochenen Satz, KEIN Meta-Kommentar, keine " +
    "Regieanweisungen. Bestaetige eine getroffene Terminabsprache freundlich und knapp.",
  scriptedTurns: { 0: "Dienstag um 14 Uhr haetten wir frei, das kostet 55 Euro." },
  sttNoise: false,
  maxTurns: 6,
  minTurnsBeforeAgentHangup: 3,
  expectDegradation: false,
  recapSubstrings: ["dienstag", "14 uhr", "55 euro"],
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
  expectedResult: [
    { slot: "day", any: ["dienstag"] },
    { slot: "time", any: ["14", "zwei"] },
    { slot: "price", any: ["55"] },
  ],
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "no_message_taken",
    "no_consult_fired",
    "no_invented_promise",
    "farewell_before_terminal",
    "turn_count_within_budget",
    "no_transliterated_umlauts_de",
    "recap_present",
    "result_slots_present",
  ],
  mustNotAskSubstrings: [],
  mustNotPromiseSubstrings: [
    "gebe ich weiter",
    "gebe das weiter",
    "melde sich",
    "rufe ich zurueck",
    "rufe ich noch mal an",
  ],
  judgeFocus:
    "Bewerte streng, ob der Agent das Angebot (Dienstag 14 Uhr, 55 Euro) SELBST verbindlich " +
    "zusagt. Es liegt vollstaendig in seinem Mandat. Ein Ausweichen auf 'ich gebe das weiter' " +
    "oder eine Rueckfrage-Ankuendigung ist ein FAIL.",
};
