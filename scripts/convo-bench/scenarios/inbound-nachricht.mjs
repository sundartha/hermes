// Szenario "inbound-nachricht" (Spec §9): inbound via /voice/incoming. Der Anrufer
// will lediglich eine Nachricht fuer den Besitzer hinterlassen. Prueft, dass die
// Pflicht-Offenlegung (NUR fuer Outbound vorgeschrieben) hier NICHT faelschlich
// mitgesprochen wird, und dass das Anliegen als Action Item ankommt.
export default {
  id: "inbound-nachricht",
  direction: "inbound",
  assistantContextEnabled: false,
  goal: null,
  briefing: null,
  constraints: null,
  context: null,
  callerNumber: "+4915199990001",
  personaPrompt:
    "Du rufst bei einem Geschaeftskontakt an. Der ist gerade nicht erreichbar, stattdessen " +
    "meldet sich ein KI-Assistent. Du moechtest lediglich eine kurze Nachricht hinterlassen: " +
    "'Bitte zurueckrufen wegen der Rechnung von letzter Woche.' Antworte in 1 kurzem " +
    "gesprochenen Satz, KEIN Meta-Kommentar.",
  scriptedTurns: {},
  sttNoise: false,
  maxTurns: 6,
  expectDegradation: false,
  checks: [
    "inbound_no_disclosure_leak",
    "message_taken",
    "turn_count_within_budget",
    "no_transliterated_umlauts_de",
  ],
  mustNotAskSubstrings: [],
  judgeFocus: null,
};
