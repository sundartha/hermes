// Die Inbound-Pfad-Sonde: GENAU EINE Zeile je Inbound-Leg, IMMER - auch im Normalfall.
// Eine Sonde, die nur den Defekt meldet, ist im Live-Log nicht von einem Deploy ohne
// Sonde zu unterscheiden (Begruendung aus GQ-P3, B-9: das Boot-Banner kennt den Schalter,
// nicht den einzelnen Anruf). PII-frei: callId ist server-generiert, path ein fester Token.
// Konsumenten JE FUNKTION:
//   INBOUND_PATH     -> src/routes/voice.js (/voice/incoming)
//   logInboundPath   -> src/routes/voice.js (/voice/incoming)
// Seit IE6-S1 gibt es genau EINEN Pfad. Ein kuenftiger Uebergabe-Pfad (IE5) ergaenzt
// HIER einen Token - nie eine zweite Logzeile fuer denselben Sachverhalt (PLAN 5.4).
// Rein: kein IO ausser der einen Logzeile, kein config-Import.
const INBOUND_PATH_LOG_PREFIX = "[inbound-path]";

export const INBOUND_PATH = Object.freeze({
  BUDGET: "budget",
});

// Nebeneffekt im Namen (N7): schreibt die eine Sonden-Zeile.
export function logInboundPath({ callId, path }) {
  console.log(`${INBOUND_PATH_LOG_PREFIX} inbound_path ${JSON.stringify({ callId, path })}`);
}
