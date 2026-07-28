// Szenario "anrufbeantworter" (AL-P8): scriptedTurns[0] ist eine lange Ansage
// ("Sie haben den Anschluss von ... erreicht. Bitte hinterlassen Sie nach dem
// Signalton eine Nachricht."), danach zwei stille Turns (der Anrufbeantworter zeichnet
// stumm auf). Gemessen wird eine knappe Nachricht + Auflegen statt eines Dialogversuchs
// mit einer Maschine. Die PROVIDER-seitige AMD (MACHINE_DETECTION_ENABLED) wird hier
// NICHT simuliert - gemessen wird das Gespraechsverhalten, nicht die Erkennung.
import { MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "anrufbeantworter",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Rueckruf wegen der offenen Rechnung erbitten",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du bist ein Anrufbeantworter (nur fuer den Fall, dass die Persona-Schleife nach den " +
    "geskripteten/stillen Turns doch einmal aufgerufen wird). Antworte NICHT wie ein Mensch.",
  scriptedTurns: {
    0: "Sie haben den Anschluss von Mueller GmbH erreicht. Bitte hinterlassen Sie nach dem Signalton eine Nachricht.",
  },
  silentTurns: [1, 2],
  sttNoise: false,
  maxTurns: 6,
  expectDegradation: false,
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "no_verbatim_question_repeat",
    "turn_count_within_budget",
  ],
  mustNotAskSubstrings: [],
  mustNotPromiseSubstrings: [],
  judgeFocus:
    "Bewerte streng, ob der Agent nach der Ansage eine knappe, sinnvolle Nachricht " +
    "hinterlaesst und abschliesst - statt einen Dialog mit dem Anrufbeantworter zu " +
    "versuchen (mehrfaches Nachfragen in die Stille) oder gar nicht zu reagieren.",
};
