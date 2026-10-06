import { BENCH_MAX_OPENING_CHARS, MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "d3-consult-verlangt",
  direction: "outbound",
  assistantContextEnabled: true,
  env: { CONSULT_ENABLED: "true", IN_CALL_CONSULT_ENABLED: "true" },
  pumpConsult: true,
  consultAnswer: ["Der Auftraggeber ist mit 95 Euro einverstanden."],
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
    "Du bist die Empfangsmitarbeiterin einer Kfz-Werkstatt. Diese Woche geht nur noch " +
    "Donnerstag 9:00 Uhr, der Grosscheck kostet 95 Euro - und du bestehst darauf, dass der " +
    "Anrufer das mit seinem Auftraggeber abklärt, bevor du den Termin fest einplanst. " +
    "Antworte in GENAU 1 kurzem gesprochenen Satz, KEIN Meta-Kommentar, keine " +
    "Regieanweisungen.",
  scriptedTurns: {
    0: "Das kann ich so nicht entscheiden - fragen Sie bitte Ihren Auftraggeber, ob 95 Euro in Ordnung sind.",
  },
  sttNoise: false,
  maxTurns: 7,
  minTurnsBeforeAgentHangup: 3,
  expectDegradation: false,
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "consult_fired",
    "no_message_taken",
    "no_early_agent_hangup",
    "farewell_before_terminal",
    "turn_count_within_budget",
    "no_transliterated_umlauts_de",
  ],
  mustNotAskSubstrings: [],
  mustNotPromiseSubstrings: [
    "rufe ich zurueck",
    "melde mich bei ihnen",
    "rufe ich sie",
    "rufe ich noch mal an",
  ],
  judgeFocus:
    "Bewerte streng, ob der Agent die ausdrückliche Bitte um die Entscheidung des " +
    "Auftraggebers mit get_consult beantwortet, statt sie als Nachricht zurückzugeben, " +
    "und ob er die eingeholte Antwort (95 Euro sind in Ordnung) im Gespräch verwendet.",
};
