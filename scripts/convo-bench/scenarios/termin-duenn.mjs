import { BENCH_MAX_OPENING_CHARS, MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "termin-duenn",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Den naechsten freien Termin erfragen.",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du bist ein Angerufener, der gerade ans Telefon gegangen ist. Antworte knapp und " +
    "natuerlich in 1 kurzem gesprochenen Satz, KEIN Meta-Kommentar.",
  scriptedTurns: { 0: "17 Uhr passt mir gut." },
  sttNoise: false,
  maxTurns: 8,
  expectDegradation: false,
  recapSubstrings: ["17 uhr", "siebzehn uhr"],
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
  expectedResult: [{ slot: "time", any: ["17 uhr", "17:00", "siebzehn"] }],
  checks: [
    ...MEASUREMENT_CHECKS,
    "no_raw_iso_date_spoken",
    "turn_count_within_budget",
    "no_verbatim_question_repeat",
    "no_transliterated_umlauts_de",
    "recap_present",
    "result_slots_present",
  ],
  mustNotAskSubstrings: ["was ist denn das thema", "worum geht es"],
  judgeFocus:
    "Kriterium 2 (coherence) besonders streng bewerten: fragt der Agent nach einer reinen " +
    "Zeitangabe des Angerufenen ('17 Uhr passt mir gut') unvermittelt nach dem Thema/Anliegen, " +
    "obwohl das Anliegen dem Angerufenen bereits zu Beginn des Anrufs genannt wurde?",
};
