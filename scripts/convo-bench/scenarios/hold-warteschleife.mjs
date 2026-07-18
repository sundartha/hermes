// Szenario "hold-warteschleife" (PLAN-CONVERSATION-QUALITY-V2 P4): der Angerufene legt
// den Hoerer beiseite ("Moment, ich schaue nach") und schweigt zwei Turns lang. Gemessen
// wird, ob der Agent die Wartezeit aushaelt, statt vor der Klaerung aufzulegen, und ob er
// nach der Rueckkehr an SEINE Frage anknuepft statt neu zu eroeffnen.
// scriptedTurns[0] pinnt den Hold-Ausloeser deterministisch (Muster termin-duenn);
// silentTurns 1+2 gehen als LEERES SpeechResult raus - genau das, was ein Gather ohne
// Erkennung liefert. Bewusst ZWEI stille Turns: die P3.2-Staffel (no-speech-escalation)
// legt erst beim DRITTEN leeren Gather selbst auf; drei stille Turns wuerden also den
// deterministischen Server-Pfad messen statt die Modell-Entscheidung.
export default {
  id: "hold-warteschleife",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Erfragen, ob am Samstag um 19 Uhr ein Tisch für zwei Personen frei ist",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du arbeitest im Restaurant 'Zur Linde' und bist gerade ans Telefon gegangen. Du hast " +
    "im Reservierungsbuch nachgesehen: Samstag 19 Uhr ist noch ein Tisch für zwei frei. " +
    "Antworte IMMER in GENAU 1 kurzem gesprochenen Satz, KEIN Meta-Kommentar, keine " +
    "Regieanweisungen.",
  scriptedTurns: { 0: "Moment, ich schaue kurz im Buch nach." },
  silentTurns: [1, 2],
  sttNoise: false,
  maxTurns: 8,
  // Eroeffnung(1) + Reaktion auf "Moment"(2) + zwei Reprompts(3,4) + Reaktion auf die
  // Rueckkehr(5): frueher als beim 5. Agenten-Turn ist ein Hangup zwangslaeufig "vor
  // der Klaerung".
  minTurnsBeforeAgentHangup: 5,
  expectDegradation: false,
  checks: [
    "disclosure_first",
    "no_early_agent_hangup",
    "no_verbatim_question_repeat",
    "farewell_before_terminal",
    "turn_count_within_budget",
  ],
  mustNotAskSubstrings: [],
  judgeFocus:
    "Bewerte streng, ob der Agent die Wartezeit aushält: Auflegen oder Themenwechsel " +
    "während der Stille ist ein FAIL. Nach der Rückkehr des Angerufenen muss er an " +
    "SEINE offene Frage anknüpfen, statt das Anliegen neu zu eröffnen.",
};
