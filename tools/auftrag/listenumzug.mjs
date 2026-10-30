import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ALTVERSTOESSE, KOPIEN, UNTERDRUECKUNGEN, altverstoesseAusgelagert, kopienAusgelagert, unterdrueckungenAusgelagert } from "../auslagerung-eintraege.mjs";
import { LISTENPFADE, lesbar, listenNachUmzug } from "./bestandslisten.mjs";
import { aenderungenSeit, vormerken } from "./git.mjs";
import { nurTypenNachgezogen } from "./importendungen.mjs";

export const LISTENUMZUG = fileURLToPath(import.meta.url);
const EXIT_GRUEN = 0;
const EXIT_AUFRUF = 2;
const AUSGELAGERTE_LISTEN = [
  { pfad: UNTERDRUECKUNGEN, umziehen: unterdrueckungenAusgelagert, meldung: (anzahl) => `${anzahl} Einträge mit ihren wortgleich ausgelagerten Funktionen umgezogen` },
  { pfad: ALTVERSTOESSE, umziehen: altverstoesseAusgelagert, meldung: (anzahl) => `${anzahl} Altverstöße der alten Datei für die ausgelagerte Datei übernommen` },
  { pfad: KOPIEN, umziehen: kopienAusgelagert, meldung: (anzahl) => `${anzahl} Kopien-Einträge der alten Datei auf die wortgleich ausgelagerte Datei umgezogen` },
];

export const UMZUGSLISTEN = [...new Set([...LISTENPFADE, ...AUSGELAGERTE_LISTEN.map(({ pfad }) => pfad)])];

async function ausgelagerteListenUmziehen({ basis, root }) {
  for (const { pfad, umziehen, meldung } of AUSGELAGERTE_LISTEN) {
    const ausgelagert = await umziehen({ basis, root });
    if (ausgelagert === undefined) continue;
    writeFileSync(join(root, pfad), ausgelagert.neu);
    vormerken([pfad], root);
    console.log(`${pfad}: ${meldung(ausgelagert.anzahl)}.`);
  }
}

export async function listenUmziehen({ basis, root }) {
  vormerken(aenderungenSeit(basis, root).map(({ pfad }) => pfad), root);
  const { paare, hinweise } = await nurTypenNachgezogen({ basis, root }, []);
  const listen = listenNachUmzug(root, new Map(paare.map(({ alt, neu }) => [alt, neu])));
  const meldungen = listen.flatMap(({ pfad, meldungen: zeilen }) => zeilen.map((zeile) => `${pfad}: ${zeile}.`));
  for (const zeile of [...hinweise, ...meldungen]) console.log(zeile);
  const umgezogen = listen.filter(({ text, neu }) => neu !== text);
  for (const { pfad, neu, anzahl } of umgezogen) {
    writeFileSync(join(root, pfad), neu);
    console.log(`${pfad}: ${anzahl} Pfade auf die neue Datei umgezogen.`);
  }
  vormerken(umgezogen.map(({ pfad }) => pfad), root);
  console.log(`${umgezogen.length} Listen für ${paare.length} nur-Typen-Umbenennungen umgezogen.`);
  if (paare.length === 0) await ausgelagerteListenUmziehen({ basis, root });
  return EXIT_GRUEN;
}

function listenStand(root, pfade) {
  return new Map(pfade.map((pfad) => [pfad, lesbar(join(root, pfad))]));
}

export function umzugGemerkt(root, schritt, pfade = UMZUGSLISTEN) {
  const vorher = listenStand(root, pfade);
  const gruen = schritt();
  const nachher = listenStand(root, pfade);
  const umzug = [...vorher].filter(([pfad, text]) => text !== undefined && nachher.get(pfad) !== text);
  return { gruen, umzug: umzug.map(([pfad, text]) => ({ pfad, vorher: text, nachher: nachher.get(pfad) })) };
}

export function umzugZuruecknehmen(root, umzug = []) {
  const zurueck = [];
  for (const { pfad, vorher, nachher } of umzug.toReversed()) {
    if (lesbar(join(root, pfad)) !== nachher) continue;
    writeFileSync(join(root, pfad), vorher);
    zurueck.push(pfad);
  }
  vormerken(zurueck, root);
}

async function aufruf() {
  const { values } = parseArgs({ options: { basis: { type: "string" } } });
  if (values.basis === undefined) {
    console.error("Aufruf: node tools/auftrag/listenumzug.mjs --basis <commit>");
    return EXIT_AUFRUF;
  }
  return listenUmziehen({ basis: values.basis, root: process.cwd() });
}

if (import.meta.url === pathToFileURL(realpathSync(argv[1] ?? ".")).href) process.exitCode = await aufruf();
