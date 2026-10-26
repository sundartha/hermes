import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { ENTWURF_HINWEIS, ENTWURF_ROUTE, FUNDSTELLE, GRUEN_PRUEFLISTE, GRUPPEN, HINWEIS, LOESUNG, ORDNER, ROUTE, WEGPRUEFUNGEN, alsJson, angaben, aufrufe, auftrag, bericht, exit, plane as planeLauf, planeIn, schnittliste } from "./planung-probe.js";
import { REPO_ROOT, commitPaths, mitUpstreamMaster, runIn } from "./probe-repo.js";

export const AUFTRAG = join(REPO_ROOT, "tools/auftrag.mjs");
export const EXIT_GRUEN = 0;
export const EXIT_ABBRUCH = 1;
export const EXIT_AUFRUF = 2;
export const EXIT_PASST_NICHT = 3;
export const EXIT_BEFUNDE = 4;
export const EXIT_GETEILT = 7;
export const ABSTURZ_EXIT = 3;
export const ABSTURZ_FEHLER = "Error: spawn claude ENOENT";
export const WARTEN_MS = 1500;

export function planeAntworten() {
  return {
    "planer|## Gliederung": [alsJson({ gruppen: GRUPPEN })],
    "erkunder|## Erkundung|S1": [bericht(GRUPPEN[0].nummern)],
    "erkunder|## Erkundung|S4": [bericht(GRUPPEN[1].nummern)],
    "planer|## Zuschnitt": [alsJson({ schnitt: schnittliste() })],
    "pruefer-planung|## Wegprüfung": Array.from({ length: WEGPRUEFUNGEN }, () => GRUEN_PRUEFLISTE),
    "pruefer-planung|## Prüfung": jePruefer(GRUEN_PRUEFLISTE),
    "pruefer-planung|## Nachprüfung": [GRUEN_PRUEFLISTE],
    [`entwurf|## Entwurf|${ROUTE}`]: [ENTWURF_ROUTE],
    [`entwurf|## Entwurf|${HINWEIS}`]: [ENTWURF_HINWEIS],
  };
}

export function teilEintrag(kuerzel, name, { nummern, tWege = [], dateien, abhaengigVon = [], nurUmbau = false }) {
  return { kuerzel, name, nummern, tWege, dateien, nurUmbau, abhaengigVon, grund: `${name} hat einen eigenen Eingang` };
}

export function pruefeTeilungOhneErkundung(lauf) {
  exit(lauf, EXIT_GETEILT);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung"), []);
  const [nachricht] = aufrufe(lauf, "planer", "## Teilung");
  return nachricht.eingabe;
}

export function plane(context, ueberschrieben = {}, argumente = [ORDNER]) {
  return planeLauf(context, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ...argumente] });
}

export const ABBRUCH_IM_SCHNITT = { "planer|## Zuschnitt": [`Zerlegung passt nicht: Dann widerspricht der Lösung (Fundstellen: pitch.md, ## Problem; design.md, ${LOESUNG})`] };

export const SCHNITT_SOFORT = { "planer|## Zuschnitt": [alsJson({ schnitt: schnittliste() })] };

export const EXIT_DECKEL = 5;
const ROLLEN_TOKEN = { planer: 100_000, erkunder: 1_000_000, "pruefer-planung": 340_000, entwurf: 100_000 };
const ERKUNDER_MIT_WEG = ROLLEN_TOKEN.erkunder + ROLLEN_TOKEN["pruefer-planung"];
const BIS_ZUR_NACHFRAGE = 2 * ROLLEN_TOKEN.planer + GRUPPEN.length * ERKUNDER_MIT_WEG;
export const HALT_VOR_DER_RUECKSENDUNG = BIS_ZUR_NACHFRAGE + 0.5 * ROLLEN_TOKEN.erkunder;
export const OHNE_GRENZE = String(1_000_000_000);

export function mitDeckel(context, wurzel, { argumente, ueberschrieben }) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER, ...argumente], token: ROLLEN_TOKEN });
}

const WERKZEUG_DATEI = "tools/nachtrag.mjs";

export function abgebrochen(context, zusatz = {}) {
  const lauf = plane(context, { ...ABBRUCH_IM_SCHNITT, ...zusatz });
  exit(lauf, EXIT_PASST_NICHT);
  return lauf;
}

export const FORTSETZEN = [ORDNER, "--fortsetzen"];

export function fortsetzung(context, { wurzel }, { argumente = FORTSETZEN, ueberschrieben = SCHNITT_SOFORT } = {}) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ...argumente] });
}

export function planungsDatei({ wurzel }, name) {
  return join(wurzel, ORDNER, "planung", name);
}

export function aendereWerkzeug({ wurzel }, { committet }) {
  writeFileSync(join(wurzel, WERKZEUG_DATEI), "export const nachtrag = 1;\n");
  if (committet) commitPaths(wurzel, [WERKZEUG_DATEI], "Werkzeug");
}

export function phaseDatei({ wurzel }) {
  return join(wurzel, ORDNER, "phase.json");
}

export function planungsBericht({ wurzel }, ordner = ORDNER) {
  return JSON.parse(readFileSync(join(wurzel, ".fortschritt", basename(ordner), "planung.json"), "utf8"));
}

export function ersetze(datei, alt, neu) {
  const vorher = readFileSync(datei, "utf8");
  assert.ok(vorher.includes(alt), vorher);
  writeFileSync(datei, vorher.replace(alt, neu));
}

export function mitIssue(wurzel, ordner, issue) {
  ersetze(join(wurzel, ordner, "pitch.md"), "Issue: offen", `Issue: ${issue}`);
}

export function vorgaengerGemergt(wurzel, ordner) {
  const nachricht = `Baue ${basename(ordner)}\n\nAuftrag: ${basename(ordner)}/a1\nArt: funktion`;
  const commit = runIn(wurzel, "git", ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-q", "--allow-empty", "-m", nachricht]);
  assert.equal(commit.status, 0, commit.stderr);
  mitUpstreamMaster(wurzel);
}

export function werkzeug({ wurzel }, ...argumente) {
  return runIn(wurzel, process.execPath, argumente);
}

export const A2_BEFUND = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": "a2 braucht den Code aus a1" } };

export const A2_KORRIGIERT = { ziel: "Ziel a2 mit dem Code aus a1" };

export const A2_ANTWORT = [{ schluessel: "allein-gruen:a2", antwort: "korrigiert: a2 liest den Code aus a1" }];

const ZUSATZ_TESTS = { a14: "rueckruf", a15: "ansage", a16: "sperre", a17: "notiz", a18: "zeitfenster", a19: "sprache", a20: "warteschlange", a21: "weiterleitung", a22: "mailbox", a23: "rueckfrage" };

export function zusatz(id, prueft) {
  return auftrag(id, HINWEIS, { prueft, abnahme: `test/anrufe/hinweis-${ZUSATZ_TESTS[id]}.test.js`, abhaengigVon: [] });
}

export function korrektur({ a2 = {}, a3 = {}, dazu = [] } = {}) {
  const schnitt = schnittliste();
  const geaendert = { a2, a3 };
  return { ...schnitt, auftraege: [...schnitt.auftraege.map((eintrag) => ({ ...eintrag, ...geaendert[eintrag.id] })), ...dazu] };
}

export function antwortMit(schnitt, antworten = A2_ANTWORT) {
  return alsJson({ schnitt, antworten });
}

export const OHNE_NUMMER = korrektur({ a2: A2_KORRIGIERT, dazu: [zusatz("a14", [])] });

export const MIT_NUMMER = korrektur({ a2: A2_KORRIGIERT, a3: { prueft: ["S4", "B1"] }, dazu: [zusatz("a14", ["S5"])] });

export const UEBERGREIFENDER_PRUEFER = 1;

export function jePruefer(eintrag) {
  return Array.from({ length: GRUPPEN.length + UEBERGREIFENDER_PRUEFER }, () => eintrag);
}

export function auftragAus(schnitt, id, geaendert = {}) {
  return { ...schnitt.auftraege.find((eintrag) => eintrag.id === id), ...geaendert };
}

export function geplanteListe({ wurzel }) {
  return JSON.parse(readFileSync(join(wurzel, ORDNER, "planung", "schnitt.json"), "utf8"));
}

export const WEGFEHLER = { ...GRUEN_PRUEFLISTE, befunde: { "weg:S7": "der Weg endet nicht in speichereStatus" } };

export const WEG_ZEILE = `Weg S7: der Weg endet nicht in speichereStatus (Fundstelle: ${FUNDSTELLE})`;

export function wegpruefungen(lauf, erste) {
  return aufrufe(lauf, "pruefer-planung", "## Wegprüfung").filter(({ eingabe }) => eingabe.includes(`#### ${erste} (`));
}

export function offenePunkte({ eingabe }) {
  const [, offen] = eingabe.split("### Offene Punkte");
  return offen.split("\n### ")[0];
}

export function wegfehlerLaufMitKorrektur(context, hinweis) {
  const korrigiert = alsJson({ nummern: Object.fromEntries(GRUPPEN[0].nummern.map((nummer) => [nummer, angaben(nummer)])), hinweise: [hinweis] });
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, GRUEN_PRUEFLISTE], "erkunder|## Befunde": [korrigiert] });
  exit(lauf, EXIT_GRUEN);
  return lauf;
}

export function gruppenPruefung(lauf, nummer) {
  return aufrufe(lauf, "pruefer-planung", "## Prüfung").find(({ eingabe }) => eingabe.includes("### Erkundungsbericht deiner Gruppe") && eingabe.includes(`#### ${nummer} (`));
}

export function abgelegt({ wurzel }, name) {
  return JSON.parse(readFileSync(join(wurzel, ORDNER, "planung", name), "utf8"));
}

export function prueflisteZeilen({ eingabe }) {
  const [, zeilen] = eingabe.split("### Zeilen deiner Prüfliste");
  return zeilen.split("\n").filter((zeile) => zeile.startsWith("- ")).map((zeile) => zeile.slice(2));
}

export function zeilenDes(id) {
  return ["nie-saetze", "allein-gruen", "nicht-zusammengelegt"].map((regel) => `${regel}:${id}`);
}
