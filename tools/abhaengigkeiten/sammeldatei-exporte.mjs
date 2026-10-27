import ts from "typescript";

import { aufDerBasis, imArbeitsbaum } from "./bestaende.mjs";
import { run } from "./prozess.mjs";
import { exportDerAnweisung } from "../testwirkung/erreicht.mjs";
import { inhalt } from "../umbenennung.mjs";

export const EXPORTLISTE = "tools/basis/sammeldatei-exporte.json";

const TRENNER = "#";
const SPEICHER =
  "Eine neue Speicherfunktion kommt als reine Funktion über den Zustand in eine Datei ihres Themas unter src/store/zustand/ und wird in zustandsFunktionen() in src/store/zustand/anbindung.js gebunden: lesend wie anrufpauseAktiv; schreibend gibt sie { ergebnis, geaendert } zurück und wird mit schreibend gebunden, das nach dem Aufruf speichert, wenn geaendert gilt (fehlt schreibend in anbindung.js noch, kommt es mit der ersten schreibenden Funktion dazu). Ihr Name kommt in die Liste von src/store.js. Darüber haben der JSON-Speicher, der Postgres-Speicher und makePgTestStore aus test/pg-helpers.js sie; Tests rufen sie über src/store.js oder makePgTestStore.";
const ORT = new Map([
  ["src/store/state-ops.js", SPEICHER],
  ["src/store/json.js", SPEICHER],
  ["src/store/pg.js", SPEICHER],
  [
    "src/store/defaults.js",
    "Eine neue Konstante steht in der Datei, die sie nutzt (für eine Speicherfunktion deren Datei unter src/store/zustand/); brauchen andere Bausteine oder Tests sie, reicht src/store.js sie weiter wie MAX_CALL_DURATION_CAP_S.",
  ],
  [
    "src/config.js",
    "Ein neuer Konfigurationswert ist ein Schlüssel im passenden Namensraum von CONFIG_NAMESPACES und wird als config.<namensraum>.<schlüssel> gelesen; eine neue Hilfsfunktion steht in der Datei, die sie nutzt.",
  ],
  [
    "src/mcp-tools.js",
    "Neue Werte und Hilfen eines Werkzeugs stehen in einer eigenen Datei, die src/mcp-tools.js importiert, wie src/call-result.js; Tests prüfen das Werkzeug über registerTools.",
  ],
]);

function zwilling(datei) {
  return [...new Set([datei, datei.replace(/\.js$/, ".ts")])];
}

const STERN = /^export \* from (".*");$/;

function sternAlsName(zeile) {
  return `*:${JSON.parse(STERN.exec(zeile)[1])}`;
}

function exportNamen(pfad, text) {
  const baum = ts.createSourceFile(pfad, text, ts.ScriptTarget.Latest);
  return baum.statements.flatMap((knoten) => {
    const { namen, sterne } = exportDerAnweisung(knoten);
    return [...namen, ...sterne.map(sternAlsName)];
  });
}

const gelesen = new Map();

function exporteIm(stand, datei) {
  const schluessel = `${stand ?? ""}:${datei}`;
  if (!gelesen.has(schluessel)) gelesen.set(schluessel, exporteLesen(stand, datei));
  return gelesen.get(schluessel);
}

function exporteLesen(stand, datei) {
  return zwilling(datei).flatMap((pfad) => {
    const text = inhalt(stand, pfad);
    return text === undefined ? [] : [{ pfad, namen: new Set(exportNamen(pfad, text)) }];
  });
}

function dateienDer(liste) {
  return [...new Set(liste.map((eintrag) => eintrag.slice(0, eintrag.indexOf(TRENNER))))];
}

const FELDER_JE_UMBENENNUNG = 3;
const FELDER_JE_EINTRAG = 2;

function umbenannteDateien(basis) {
  const lauf = run("git", ["diff", "-M", "--name-status", "-z", basis, "--"]);
  const felder = lauf.status === 0 ? lauf.stdout.split("\0") : [];
  const neuerPfad = new Map();
  for (let stelle = 0; stelle + 1 < felder.length; ) {
    const [art, alt, neu] = felder.slice(stelle, stelle + FELDER_JE_UMBENENNUNG);
    const umbenannt = art.startsWith("R");
    if (umbenannt) neuerPfad.set(alt, neu);
    stelle += umbenannt ? FELDER_JE_UMBENENNUNG : FELDER_JE_EINTRAG;
  }
  return neuerPfad;
}

function umbenennungsBefunde(datei, neuerPfad) {
  const ziel = zwilling(datei).map(neuerPfad).find((pfad) => pfad !== undefined);
  return ziel === undefined ? [] : [umbenennungsBefund(datei, ziel)];
}

function umbenennungsBefund(datei, ziel) {
  return `${datei}: Die Sammeldatei wird nach ${ziel} umbenannt. Eine Sammeldatei wird nicht umbenannt, sondern aufgelöst: Datei und ihre Einträge in ${EXPORTLISTE} zusammen entfernen, die Funktionen kommen an ihren Ort. ${ORT.get(datei) ?? ""}`.trimEnd();
}

function neueExporte(liste, basis) {
  const eingefroren = new Set(liste);
  const dateien = new Set([...dateienDer(liste), ...dateienDer(aufDerBasis(basis, EXPORTLISTE) ?? [])]);
  let umbenannt;
  const neuerPfad = (datei) => (umbenannt ??= umbenannteDateien(basis)).get(datei);
  return [...dateien].flatMap((datei) => {
    const jetzt = exporteIm(undefined, datei);
    if (jetzt.length === 0) return umbenennungsBefunde(datei, neuerPfad);
    const vorher = new Set(exporteIm(basis, datei).flatMap(({ namen }) => [...namen]));
    return jetzt.flatMap(({ pfad, namen }) =>
      [...namen]
        .filter((name) => !eingefroren.has(`${datei}${TRENNER}${name}`) || !vorher.has(name))
        .map((name) => `${pfad}: neuer Export „${name}“. Die Sammeldatei bekommt keinen neuen Export und keinen entfernten zurück. ${ORT.get(datei) ?? ""}`.trimEnd()),
    );
  });
}

function gewachseneListe(liste, basis) {
  const vorher = aufDerBasis(basis, EXPORTLISTE);
  if (vorher === undefined) return [];
  const erlaubt = new Set(vorher);
  return liste
    .filter((eintrag) => !erlaubt.has(eintrag))
    .map((eintrag) => `${EXPORTLISTE} darf nur kürzer werden, neu eingefroren ist: ${eintrag}.`);
}

export function sammeldateiBefunde(basis) {
  const liste = imArbeitsbaum(EXPORTLISTE);
  return [...gewachseneListe(liste, basis), ...neueExporte(liste, basis)];
}

export function sammeldateiZusammenfassung() {
  const liste = imArbeitsbaum(EXPORTLISTE);
  if (liste.length === 0) return undefined;
  const ueberzaehlig = liste.filter((eintrag) => {
    const datei = eintrag.slice(0, eintrag.indexOf(TRENNER));
    const name = eintrag.slice(datei.length + TRENNER.length);
    return !exporteIm(undefined, datei).some(({ namen }) => namen.has(name));
  });
  return `${liste.length} Exporte von ${dateienDer(liste).length} Sammeldateien, eingefroren in ${EXPORTLISTE}; ${ueberzaehlig.length} davon gibt es nicht mehr, sie können gestrichen werden`;
}
