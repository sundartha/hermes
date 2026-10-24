import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { befundeImOrdner } from "./auftrag/planung/abdeckung.mjs";
import { phasenAbsichtBefunde } from "./auftrag/planung/absicht.mjs";
import { PITCH, SICHERHEIT } from "./auftrag/planung/nummern.mjs";
import { zeilenbelegBefunde } from "./auftrag/planung/zeilenbeleg.mjs";
import { MELDUNG, zweckBlock } from "./auftrag/zweck.mjs";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const ERSTES_EIGENES_ARGUMENT = 2;
const AUFRUF_HINWEIS = "Aufruf: node tools/abdeckung-pruefen.mjs plaene/P-<Nummer>-<kurzname>/";
const PHASE = "phase.json";

function unlesbar(grund) {
  return { befunde: [`${PHASE} ist nicht lesbar: ${grund}`] };
}

function artDes(wert) {
  if (wert === null) return "null";
  return Array.isArray(wert) ? "array" : typeof wert;
}

function ladePhase(ordner) {
  let phase;
  try {
    phase = JSON.parse(readFileSync(join(ordner, PHASE), "utf8"));
  } catch (fehler) {
    return unlesbar(fehler.message);
  }
  if (artDes(phase) !== "object") return unlesbar(`erwartet ein JSON-Objekt, gefunden ${artDes(phase)}`);
  return { phase };
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
  const { phase } = geladen;
  const { anzahl, befunde } = phase ? befundeImOrdner(ordner, phase) : { anzahl: 0, befunde: geladen.befunde };
  if (phase) befunde.unshift(...phasenAbsichtBefunde(readFileSync(join(ordner, PITCH), "utf8"), phase));
  befunde.push(...zeilenbelegBefunde(ordner, process.cwd()));
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
