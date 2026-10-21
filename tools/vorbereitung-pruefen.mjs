import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ESLint } from "eslint";

import { MELDUNG, befundeMeldenUndScheitern } from "./auftrag/zweck.mjs";
import { inhalt, laufzeitBaum, laufzeitText, umbenennungen } from "./umbenennung.mjs";
import { ersteAbweichung, normalform, vergleichstext } from "./vorbereitung/normalform.mjs";

const QUELLDATEI = /\.[cm]?[jt]s$/;
const GEAENDERT = "M";
const ARTEN = new Map([
  ["A", "neu"],
  ["D", "gelöscht"],
]);
const COMMONJS = /\.c[jt]s$/;
const ZWEI_PHASEN =
  "Soll eine Datei nach TypeScript, braucht das zwei Phasen: Umformung an der .js in einer ersten Phase, reine Umbenennung in einer zweiten Phase.";
const PAAR = 2;
const ZEILENUMBRUCH = /\n/g;
const ERSTE_ZEILE = 1;
const PUFFER = 268_435_456;
const EXIT_ABBRUCH = 2;
const AUFRUF = "Aufruf: node tools/vorbereitung-pruefen.mjs --basis <commit> [--bis <commit>] [--bereich <json-datei>]";

function felder(text) {
  return text.split("\0").filter(Boolean);
}

function geaenderteDateien(basis, bis) {
  const lauf = spawnSync("git", ["diff", "--no-renames", "--name-status", "-z", basis, ...(bis ? [bis] : []), "--"], {
    encoding: "utf8",
    maxBuffer: PUFFER,
  });
  if (lauf.status !== 0) throw new Error(`git diff ${basis}: ${lauf.stderr.trim()}`);
  const teile = felder(lauf.stdout);
  const eintraege = [];
  for (let index = 0; index + 1 < teile.length; index += PAAR) eintraege.push({ art: teile[index], datei: teile[index + 1] });
  if (bis !== undefined) return eintraege;
  const neu = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: PUFFER });
  return [...eintraege, ...felder(neu.stdout).map((datei) => ({ art: "A", datei }))];
}

function zeileVon(text, knoten) {
  const anfang = knoten?.range?.[0];
  return anfang === undefined ? ERSTE_ZEILE : (text.slice(0, anfang).match(ZEILENUMBRUCH)?.length ?? 0) + ERSTE_ZEILE;
}

export async function vergleicheVorbereitung({ pfad, vorher, nachher }, eslint = new ESLint()) {
  const [alt, neu] = await Promise.all([vorher, nachher].map((text) => laufzeitBaum({ pfad, text }, eslint)));
  if (alt === undefined || neu === undefined) return { gleich: false, befund: `${pfad}: nicht lesbar` };
  const [links, rechts] = [normalform(alt), normalform(neu)];
  const ids = new Set([...links.genutzt.keys(), ...rechts.genutzt.keys()]);
  const genutzt = [...ids].filter((id) => links.genutzt.get(id) !== rechts.genutzt.get(id)).toSorted();
  if (vergleichstext(links.baum) === vergleichstext(rechts.baum)) return { gleich: true, genutzt };
  const zeile = zeileVon(laufzeitText(pfad, nachher), ersteAbweichung(links.baum, rechts.baum));
  return { gleich: false, befund: `${pfad}:${zeile}: Änderung, die keine Umformung aus tools/vorbereitung/katalog.json ist` };
}

async function dateiBefund({ art, datei }, { basis, bis, umbenannt, eslint }) {
  if (art !== GEAENDERT) {
    const nurTypen = (umbenannt.vorher(datei) ?? umbenannt.nurTypen(datei)) !== undefined;
    return nurTypen ? undefined : `${datei}: ${ARTEN.get(art) ?? `Art ${art}`}; das ist keine Umformung aus dem Katalog`;
  }
  if (await umbenannt.nurQuellenNachgezogen(datei)) return undefined;
  if (COMMONJS.test(datei)) return `${datei}: CommonJS läuft ohne strict mode; die Katalog-Bedingungen sind dafür nicht geprüft`;
  const vergleich = await vergleicheVorbereitung({ pfad: datei, vorher: inhalt(basis, datei), nachher: inhalt(bis, datei) }, eslint);
  if (vergleich.gleich) console.log(`${datei}: gleichwertig${vergleich.genutzt.length > 0 ? ` (${vergleich.genutzt.join(", ")})` : ""}`);
  return vergleich.befund;
}

export async function vorbereitungsBefunde({ basis, bis, bereich }) {
  const eslint = new ESLint();
  const imBereich = bereich === undefined ? () => true : (datei) => bereich.has(datei);
  const dateien = geaenderteDateien(basis, bis).filter(({ datei }) => QUELLDATEI.test(datei) && imBereich(datei));
  if (dateien.length === 0) return [];
  const umbenannt = await umbenennungen({ von: basis, bis }, eslint);
  const befunde = [];
  for (const eintrag of dateien) befunde.push(await dateiBefund(eintrag, { basis, bis, umbenannt, eslint }));
  const geloeschtOderNeu = dateien.some(({ art }, stelle) => ARTEN.has(art) && befunde[stelle] !== undefined);
  return [...befunde.filter(Boolean), ...(geloeschtOderNeu ? [ZWEI_PHASEN] : [])];
}

async function main() {
  const { values } = parseArgs({ options: { basis: { type: "string" }, bis: { type: "string" }, bereich: { type: "string" } } });
  if (values.basis === undefined) throw new Error(AUFRUF);
  const bereich = values.bereich === undefined ? undefined : new Set(JSON.parse(readFileSync(values.bereich, "utf8")));
  befundeMeldenUndScheitern(await vorbereitungsBefunde({ basis: values.basis, bis: values.bis, bereich }), MELDUNG.VORBEREITUNG);
}

if (import.meta.url === pathToFileURL(realpathSync(argv[1] ?? ".")).href) {
  try {
    await main();
  } catch (fehler) {
    console.error(`Abbruch: ${fehler.message}`);
    process.exitCode = EXIT_ABBRUCH;
  }
}
