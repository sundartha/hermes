import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ladePhase } from "../format.mjs";
import { VERLAUF, neuschnitt } from "./neuschnitt-team.mjs";
import { EXIT_AUFRUF, liste, schreibeJsonAtomar } from "./plane.mjs";

const EINGABE = "eingabe.json";
const TEXTFELDER = ["root", "ordner", "datei", "auftragId", "anlass", "kopf"];
const LISTEN = ["fertig", "verlauf", "hinweise"];

function gelesen(lies) {
  try {
    return { wert: lies() };
  } catch (fehler) {
    return { fehler: fehler.message };
  }
}

function eingabeFehler(eingabe) {
  const fehlend = [...TEXTFELDER.filter((feld) => typeof eingabe?.[feld] !== "string"), ...LISTEN.filter((feld) => !Array.isArray(eingabe?.[feld]))];
  if (fehlend.length > 0) return `in der Eingabe fehlt ${fehlend.join(", ")}`;
  return eingabe.kopf.includes(VERLAUF) ? null : "kopf enthält keinen Abschnitt „## Verlauf“";
}

function phaseDer({ root, datei, auftragId }) {
  const pfad = join(root, datei);
  if (!existsSync(pfad)) return { fehler: `die Phasendatei ${datei} gibt es nicht` };
  const phase = gelesen(() => ladePhase(pfad));
  if (phase.fehler !== undefined) return { fehler: `die Phasendatei ${datei} ist kein JSON: ${phase.fehler}` };
  return liste(phase.wert?.auftraege).some((auftrag) => auftrag?.id === auftragId) ? phase : { fehler: `${auftragId} steht nicht in ${datei}` };
}

function aufrufFehler(grund) {
  return { exitCode: EXIT_AUFRUF, grund, sitzungen: [] };
}

async function starte(ablage) {
  const pfad = join(ablage, EINGABE);
  if (!existsSync(pfad)) return aufrufFehler(`${EINGABE} fehlt in der Ablage`);
  const eingabe = gelesen(() => JSON.parse(readFileSync(pfad, "utf8")));
  if (eingabe.fehler !== undefined) return aufrufFehler(`${EINGABE} ist kein JSON: ${eingabe.fehler}`);
  const fehler = eingabeFehler(eingabe.wert);
  if (fehler !== null) return aufrufFehler(fehler);
  const phase = phaseDer(eingabe.wert);
  return phase.fehler === undefined ? neuschnitt(ablage, eingabe.wert, phase.wert) : aufrufFehler(phase.fehler);
}

const [, , angabe] = process.argv;
if (angabe === undefined) {
  console.error("Aufruf: node tools/auftrag/planung/neuschnitt-start.mjs <ablage>");
  process.exitCode = EXIT_AUFRUF;
} else {
  const ablage = resolve(angabe);
  const ergebnis = await starte(ablage);
  schreibeJsonAtomar(join(ablage, "ergebnis.json"), ergebnis);
  process.exitCode = ergebnis.exitCode;
}
