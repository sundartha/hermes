import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ladePhase } from "../format.mjs";
import { VERLAUF, neuschnitt } from "./neuschnitt-team.mjs";
import { EXIT_AUFRUF, schreibeJson } from "./plane.mjs";

const TEXTFELDER = ["root", "ordner", "datei", "auftragId", "anlass", "kopf"];
const LISTEN = ["fertig", "verlauf", "hinweise"];

function eingabeFehler(eingabe) {
  const fehlend = [...TEXTFELDER.filter((feld) => typeof eingabe?.[feld] !== "string"), ...LISTEN.filter((feld) => !Array.isArray(eingabe?.[feld]))];
  if (fehlend.length > 0) return `in der Eingabe fehlt ${fehlend.join(", ")}`;
  if (!eingabe.kopf.includes(VERLAUF)) return "kopf enthält keinen Abschnitt „## Verlauf“";
  const pfad = join(eingabe.root, eingabe.datei);
  if (!existsSync(pfad)) return `die Phasendatei ${eingabe.datei} gibt es nicht`;
  return ladePhase(pfad).auftraege.some(({ id }) => id === eingabe.auftragId) ? null : `${eingabe.auftragId} steht nicht in ${eingabe.datei}`;
}

async function starte(ablage) {
  const eingabe = JSON.parse(readFileSync(join(ablage, "eingabe.json"), "utf8"));
  const fehler = eingabeFehler(eingabe);
  if (fehler !== null) return { exitCode: EXIT_AUFRUF, grund: fehler, sitzungen: [] };
  return neuschnitt(ablage, eingabe, ladePhase(join(eingabe.root, eingabe.datei)));
}

const [, , angabe] = process.argv;
if (angabe === undefined) {
  console.error("Aufruf: node tools/auftrag/planung/neuschnitt-start.mjs <ablage>");
  process.exitCode = EXIT_AUFRUF;
} else {
  const ablage = resolve(angabe);
  const ergebnis = await starte(ablage);
  schreibeJson(join(ablage, "ergebnis.json"), ergebnis);
  process.exitCode = ergebnis.exitCode;
}
