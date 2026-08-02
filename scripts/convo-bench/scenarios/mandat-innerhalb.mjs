// Szenario "mandat-innerhalb" (P6): der Owner hat vorab ein Mandat erteilt
// ("Termin Mo-Mi nachmittags, bis 60 Euro"); die Gegenseite bietet exakt darin
// etwas an. Gemessen wird, ob der Agent SELBST verbindlich zusagt - oder ob er
// trotz Mandat auf take_message ausweicht ("ich gebe das weiter").
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
  // AL-P8: recap_present - das Angebot (Dienstag 14 Uhr, 55 Euro) sollte der Agent bei
  // der Zusage zusammenfassen (Muster mustNotPromiseSubstrings, gefaltete Wendungen).
  recapSubstrings: ["dienstag", "14 uhr", "55 euro"],
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
  // AL-P11: die Ergebnis-Karte muss Tag/Uhrzeit/Preis des zugesagten Termins tragen.
  expectedResult: [
    { slot: "day", any: ["dienstag"] },
    { slot: "time", any: ["14", "zwei"] },
    { slot: "price", any: ["55"] },
  ],
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "no_message_taken", // im Mandat wird nicht gepuntet
    // AL-D3: dieses Szenario laeuft ohne Consult-Env - get_consult wird hier NIE
    // angeboten, der Check ist heute strukturell gruen (Regressionswaechter fuer eine
    // kuenftige Konfigurationsaenderung, kein heutiger Beleg, s. tasks/al-d3-report.md).
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
