// Szenario "kauderwelsch-erstantwort" (tasks/assistant-fix-spec.md P4 / RCA-Wurzel R3):
// Repro des Live-Defekts vom 2026-07-12 - die deutsche Antwort des Angerufenen kam beim
// Modell als NL-Kauderwelsch an (R2), das Modell wertete sie als Antwort auf sein Anliegen,
// setzte objective_achieved und rief end_call (R3). Auftrag = das Wetter-Ziel des damaligen
// Testanrufs, damit das Kauderwelsch (niederlaendische Wetter-Fragmente) oberflaechlich wie
// eine Antwort AUSSIEHT - genau die Falle, in die das Modell live lief.
// scriptedTurns[0] pinnt die unverstaendliche Erstantwort deterministisch (Muster
// termin-duenn); ab Turn 1 uebernimmt die Persona und antwortet klar - so wird BEIDES
// messbar: (i) keine Sofort-Auflegung und (ii) keine Ueberkorrektur (nicht endloses
// Nachfragen, obwohl die Antwort danach klar war).
// Wichtig: das Fragment ist laenger als CALLER_SUBSTANCE_MIN_LEN -> der bestehende
// suppressEndCall-Seam greift hier NICHT. Die Prompt-Regel (end_call-Tool-Description)
// ist der einzige Schutz - das Szenario testet also sie und nicht den Seam.
import { MEASUREMENT_CHECKS } from "../checks.mjs";

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
