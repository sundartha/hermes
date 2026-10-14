import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { befundeImOrdner } from "./auftrag/planung/abdeckung.mjs";
import { PITCH, SICHERHEIT } from "./auftrag/planung/nummern.mjs";
import { MELDUNG, zweckBlock } from "./auftrag/zweck.mjs";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const ERSTES_EIGENES_ARGUMENT = 2;
const AUFRUF_HINWEIS = "Aufruf: node tools/abdeckung-pruefen.mjs plaene/P-<Nummer>-<kurzname>/";
const PHASE = "phase.json";

function ladePhase(ordner) {
  try {
    return { phase: JSON.parse(readFileSync(join(ordner, PHASE), "utf8")) };
  } catch (fehler) {
    return { befunde: [`${PHASE} ist nicht lesbar: ${fehler.message}`] };
  }
}

function pruefe(argumente) {
  if (argumente.length !== 1) {
    console.error(AUFRUF_HINWEIS);
    return EXIT_AUFRUF;
  }
  const [ordner] = argumente;
  const fehlend = [PITCH, SICHERHEIT, PHASE].filter((datei) => !existsSync(join(ordner, datei)));
  if (fehlend.length > 0) {
    console.error(`Im Ordner ${ordner} fehlt: ${fehlend.join(", ")}\n${AUFRUF_HINWEIS}`);
    return EXIT_AUFRUF;
  }
  const geladen = ladePhase(ordner);
  const { anzahl, befunde } = geladen.phase ? befundeImOrdner(ordner, geladen.phase) : { anzahl: 0, befunde: geladen.befunde };
  for (const befund of befunde) console.error(befund);
  if (befunde.length > 0) {
    console.log(`rot: ${befunde.length} Befunde in ${ordner}.`);
    console.log(zweckBlock(MELDUNG.ABDECKUNG).join("\n"));
    return EXIT_ROT;
  }
  console.log(`grün: ${anzahl} Nummern in ${ordner} gehören je genau einem Auftrag.`);
  return EXIT_GRUEN;
}

process.exitCode = pruefe(process.argv.slice(ERSTES_EIGENES_ARGUMENT));
