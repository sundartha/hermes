import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { ESLint } from "eslint";

import { istYamlOderShell, kommentareImText } from "./kommentare-yaml-shell.mjs";
import { einstellungenFuer, gelesen, gleicherBaum } from "./syntaxbaum.mjs";

const JS_ENDUNGEN = new Set([".js", ".mjs", ".cjs"]);
const STARTZEILE = "Hashbang";
const ZEILENENDE = "\n";
const LEERRAUM_AM_ENDE = /[ \t]+$/;
const LEERRAUM_AM_ANFANG = /^[ \t]+/;
const NUR_LEERRAUM = /^[ \t\r]*$/;
const RAUTE = "#";
const STARTZEILE_ZEICHEN = "#!";
const YAML_DATEI = /\.ya?ml$/;
const BASH = "bash";
const MAX_GIT_AUSGABE = 268_435_456;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const AUFRUF = "Aufruf: node tools/kommentare-loeschen.mjs [--trocken] <ordner oder datei> ...";

const ERGEBNIS = {
  bereinigt: "bereinigt",
  ohne: "ohne Kommentare",
  abweichend: "Syntaxbaum weicht ab, Datei bleibt unverändert",
  bashAbweichend: "Bash liest danach einen anderen Befehl, Datei bleibt unverändert",
  unlesbar: "nicht lesbar, Datei bleibt unverändert",
  leer: "hat danach keinen Code mehr; löschen, wenn knip sie als ungenutzt meldet",
};

function istLeererExport({ type, declaration, specifiers, source }) {
  return type === "ExportNamedDeclaration" && declaration === null && specifiers.length === 0 && source === null;
}

function ohneCode(baum) {
  return baum.body.every(istLeererExport);
}

function zeilenAnfang(text, stelle) {
  return text.lastIndexOf(ZEILENENDE, stelle - 1) + 1;
}

function zeilenEnde(text, stelle) {
  const ende = text.indexOf(ZEILENENDE, stelle);
  return ende === -1 ? text.length : ende;
}

function nurStartzeileDavor(davor) {
  return davor.startsWith(STARTZEILE_ZEICHEN) && davor.indexOf(ZEILENENDE) === davor.length - 1;
}

function ohneLeereZeileDoppelt(text, stelle) {
  const davor = text.slice(0, stelle);
  const davorLeer = stelle === 0 || davor.endsWith(`${ZEILENENDE}${ZEILENENDE}`) || nurStartzeileDavor(davor);
  if (stelle === text.length) return davorLeer && stelle > 0 ? text.slice(0, -1) : text;
  const ende = zeilenEnde(text, stelle);
  const danachLeer = NUR_LEERRAUM.test(text.slice(stelle, ende)) && ende < text.length;
  if (!davorLeer || !danachLeer) return text;
  return `${text.slice(0, stelle)}${text.slice(ende + 1)}`;
}

function ausschneiden(text, [anfang, ende]) {
  const zeileAnfang = zeilenAnfang(text, anfang);
  const zeileEnde = zeilenEnde(text, ende);
  const davor = text.slice(zeileAnfang, anfang);
  const danach = text.slice(ende, zeileEnde);
  if (NUR_LEERRAUM.test(davor) && NUR_LEERRAUM.test(danach)) {
    const bisZeilenende = Math.min(zeileEnde + 1, text.length);
    return ohneLeereZeileDoppelt(`${text.slice(0, zeileAnfang)}${text.slice(bisZeilenende)}`, zeileAnfang);
  }
  if (NUR_LEERRAUM.test(danach)) {
    return `${text.slice(0, anfang).replace(LEERRAUM_AM_ENDE, "")}${text.slice(ende)}`;
  }
  if (NUR_LEERRAUM.test(davor)) {
    return `${text.slice(0, anfang)}${text.slice(ende).replace(LEERRAUM_AM_ANFANG, "")}`;
  }
  const einzug = LEERRAUM_AM_ANFANG.exec(text.slice(zeileAnfang, anfang))?.[0] ?? "";
  const ersatz = text.slice(anfang, ende).includes(ZEILENENDE) ? `${ZEILENENDE}${einzug}` : " ";
  return `${text.slice(0, anfang).replace(LEERRAUM_AM_ENDE, "")}${ersatz}${text.slice(ende).replace(LEERRAUM_AM_ANFANG, "")}`;
}

function ohneAlle(text, bereiche) {
  return bereiche.toSorted(([links], [rechts]) => rechts - links).reduce(ausschneiden, text);
}

function jsBereinigt(text, einstellungen) {
  const baum = gelesen(text, einstellungen);
  if (baum === undefined) return { ergebnis: ERGEBNIS.unlesbar, text };
  const kommentare = baum.comments.filter(({ type }) => type !== STARTZEILE);
  if (kommentare.length === 0) return { ergebnis: ERGEBNIS.ohne, text };
  const neu = ohneAlle(text, kommentare.map(({ range }) => range));
  const neuerBaum = gelesen(neu, einstellungen);
  if (neuerBaum === undefined || !gleicherBaum(baum, neuerBaum)) {
    return { ergebnis: ERGEBNIS.abweichend, text };
  }
  return { ergebnis: ohneCode(neuerBaum) ? ERGEBNIS.leer : ERGEBNIS.bereinigt, text: neu, anzahl: kommentare.length };
}

function zeilenBereiche(text, funde) {
  const anfaenge = [0];
  for (let stelle = text.indexOf(ZEILENENDE); stelle !== -1; stelle = text.indexOf(ZEILENENDE, stelle + 1)) {
    anfaenge.push(stelle + 1);
  }
  return funde.map(({ zeile, text: kommentar }) => {
    const ende = zeilenEnde(text, anfaenge[zeile - 1]);
    return [ende - kommentar.length - RAUTE.length, ende];
  });
}

function bashGelesen(text) {
  const ergebnis = spawnSync(BASH, ["-c", `__kommentare_loeschen_probe() {\n${text}\n}\ndeclare -f __kommentare_loeschen_probe`], {
    encoding: "utf8",
  });
  return ergebnis.status === 0 ? ergebnis.stdout : undefined;
}

function shellGleich(alt, neu) {
  const vorher = bashGelesen(alt);
  return vorher !== undefined && vorher === bashGelesen(neu);
}

function yamlShellBereinigt(pfad, text) {
  const funde = kommentareImText(pfad, text);
  if (funde.length === 0) return { ergebnis: ERGEBNIS.ohne, text };
  const neu = ohneAlle(text, zeilenBereiche(text, funde));
  if (kommentareImText(pfad, neu).length > 0) return { ergebnis: ERGEBNIS.abweichend, text };
  if (!YAML_DATEI.test(pfad) && !shellGleich(text, neu)) return { ergebnis: ERGEBNIS.bashAbweichend, text };
  return { ergebnis: ERGEBNIS.bereinigt, text: neu, anzahl: funde.length };
}

async function bereinigt(pfad, text, eslint) {
  if (!JS_ENDUNGEN.has(extname(pfad))) return yamlShellBereinigt(pfad, text);
  return jsBereinigt(text, await einstellungenFuer(pfad, eslint));
}

async function betroffeneDateien(pfade, eslint) {
  const liste = execFileSync("git", ["ls-files", "-z", "--", ...pfade], { encoding: "utf8", maxBuffer: MAX_GIT_AUSGABE });
  const gefunden = [];
  for (const pfad of liste.split("\0").filter(Boolean).sort()) {
    if (istYamlOderShell(pfad)) gefunden.push(pfad);
    else if (JS_ENDUNGEN.has(extname(pfad)) && !(await eslint.isPathIgnored(pfad))) gefunden.push(pfad);
  }
  return gefunden;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { trocken: { type: "boolean", default: false } },
  });
  if (positionals.length === 0) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  const zaehler = new Map(Object.values(ERGEBNIS).map((ergebnis) => [ergebnis, 0]));
  let entfernt = 0;
  const eslint = new ESLint();
  for (const pfad of await betroffeneDateien(positionals, eslint)) {
    const vorher = readFileSync(pfad, "utf8");
    const { ergebnis, text, anzahl = 0 } = await bereinigt(pfad, vorher, eslint);
    zaehler.set(ergebnis, zaehler.get(ergebnis) + 1);
    entfernt += anzahl;
    if (ergebnis !== ERGEBNIS.ohne) console.log(`${pfad}: ${ergebnis}${anzahl > 0 ? ` (${anzahl} Kommentare)` : ""}`);
    if (!values.trocken && text !== vorher) writeFileSync(pfad, text);
  }
  const summe = [...zaehler].map(([ergebnis, anzahl]) => `${anzahl} ${ergebnis}`).join(", ");
  console.log(`Zusammenfassung: ${summe}; ${entfernt} Kommentare ${values.trocken ? "würden entfernt" : "entfernt"}.`);
  const erledigt = zaehler.get(ERGEBNIS.bereinigt) + zaehler.get(ERGEBNIS.ohne);
  return erledigt === [...zaehler.values()].reduce((summe, anzahl) => summe + anzahl, 0) ? EXIT_GRUEN : EXIT_ROT;
}

process.exitCode = await main();
