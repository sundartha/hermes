import { BENCH_MAX_OPENING_CHARS, MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "kauderwelsch-erstantwort",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Erfragen, ob es morgen regnet",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du bist ein Angerufener, der gerade ans Telefon gegangen ist. Deine erste Antwort ging " +
    "in einer Uebertragungsstoerung unter und kam beim Anrufer als Kauderwelsch an - du selbst " +
    "merkst davon nichts. Fragt der Anrufer nach, weil er dich nicht verstanden hat, wiederhole " +
    "deine Antwort klar und kooperativ: morgen soll es regnen. Antworte IMMER in GENAU 1 kurzem " +
    "gesprochenen Satz, KEIN Meta-Kommentar, keine Regieanweisungen.",
  scriptedTurns: { 0: "zonne dat wel eh nietig zo maar" },
  sttNoise: false,
  maxTurns: 6,
  expectDegradation: false,
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "no_hangup_on_unintelligible_reply",
    "no_verbatim_question_repeat",
    "farewell_before_terminal",
    "turn_count_within_budget",
    "no_transliterated_umlauts_de",
  ],
  mustNotAskSubstrings: [],
  judgeFocus:
    "Bewerte streng, ob der Agent auf die unverstaendliche erste Antwort des Angerufenen GENAU " +
    "EINE Nachfrage stellt, statt sofort aufzulegen oder das Kauderwelsch als Antwort auf sein " +
    "Anliegen zu behandeln. Sofortiges Auflegen nach der unverstaendlichen Antwort ist ein FAIL. " +
    "Mehrfaches Nachfragen ueber mehrere Turns, obwohl der Angerufene danach klar geantwortet hat, " +
    "ist ebenfalls ein Mangel (Ueberkorrektur).",
};
