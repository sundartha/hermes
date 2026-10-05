import path from "node:path";
import { mitLogMaske } from "./log-maske.js";

const STDIO_MCP_EINSTIEG = "mcp-server.js";

// Globales Crash-Netz (OT-1). Side-Effect-Install beim Import -> MUSS die erste
// Importzeile in server.js + mcp-server.js sein (vor store.js), damit Boot-
// Rejections gefangen werden (ESM-Eval-Order: importierte Module werden vor dem
// Body des Importeurs evaluiert). EIN Node-Prozess bedient ALLE Calls + das Web-
// Stack; ein entkommener Throw/Reject killt sonst jeden laufenden Call.
//
// SECRET-FREI: geloggt wird AUSSCHLIESSLICH aus dem Fehler-Objekt (message/stack),
// NIE config, Connection-String oder Env. Handler sind benannt + exportiert, damit
// sie ohne echten Prozess-Crash unit-testbar sind.

// Diagnose-String aus einem Fehler/Grund ziehen - bevorzugt der Stack, sonst die
// Message, sonst die String-Form. Beruehrt nichts ausserhalb des Arguments.
function describe(reasonOrErr) {
  if (reasonOrErr instanceof Error) return reasonOrErr.stack || reasonOrErr.message;
  return String(reasonOrErr);
}

// AC3: loggen, NICHT exiten. Eine einzelne Async-Edge (z.B. fehlgeschlagene
// Summary) darf nicht alle Calls killen.
export function onUnhandledRejection(reason) {
  console.error("[guard] unhandledRejection:", describe(reason));
}

// AC4 [ENTSCHIEDEN 2026-06-16: weiterlaufen]: loggen + Prozess WEITERLAUFEN lassen
// (kein process.exit, kein graceful-shutdown im Guard). process.exit wuerde alle
// gleichzeitigen Calls killen. Bewusste, dokumentierte Abweichung vom Node-Default
// (Zustand nach uncaughtException laut Doku undefiniert) - akzeptiertes Risiko,
// weil dieser Handler nur das Last-Resort-Netz ist; der echte Fix sind quellseitige
// try/catch (P3). Lautes [guard]-Logging macht den Vorfall sichtbar.
export function onUncaughtException(err) {
}

// Idempotent: erst abmelden, dann anmelden -> erneuter Aufruf haengt KEINEN
// zweiten Listener an (EventEmitter erlaubt sonst dieselbe Funktion mehrfach).
export function installProcessGuards() {
  process.stderr.write = mitLogMaske(process.stderr.write);
  if (path.basename(String(process.argv[1])) !== STDIO_MCP_EINSTIEG) process.stdout.write = mitLogMaske(process.stdout.write);
  process.removeListener("unhandledRejection", onUnhandledRejection);
  process.removeListener("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtException", onUncaughtException);
}

installProcessGuards(); // Side-Effect beim Import
