import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import { tokenize } from "espree";

import { FAILURE_FILE_VARIABLE } from "../../test/testbaenke-run.mjs";
import { maskiert } from "../testwirkung/aufrufe.mjs";

import { geschuetzteMuster, ladePhase, phasenBefunde } from "./format.mjs";
import { aenderungenSeit, gibtEsIn, git } from "./git.mjs";
import { PHASE_PASST_NICHT, VERSTOSS, fuehreAus, gekuerzteTestausgabe, grenzBefunde, rotUrteil } from "./pruefungen.mjs";
import { MELDUNG, zweckBlock } from "./zweck.mjs";

export const EXIT_GRUEN = 0;
export const EXIT_ROT = 1;
export const ROLLEN = ["test", "bau"];

export function hatSkript(root, name) {
  const datei = join(root, "package.json");
  if (!existsSync(datei)) return false;
  return Object.hasOwn(JSON.parse(readFileSync(datei, "utf8")).scripts ?? {}, name);
}

export function abnahmeBefehl(auftrag) {
  return ["npm", "--silent", "test", "--", auftrag.abnahme];
}

export function abnahmeLauf(abnahme, { cwd, env: umgebung }) {
  const ordner = mkdtempSync(join(tmpdir(), "abnahme-fehler-"));
  const fehlerDatei = join(ordner, "fehler.json");
  try {
    const lauf = fuehreAus("abnahme", abnahmeBefehl({ abnahme }), {
      cwd,
      env: { ...umgebung, [FAILURE_FILE_VARIABLE]: fehlerDatei },
    });
    const fehlermeldungen = existsSync(fehlerDatei) ? JSON.parse(readFileSync(fehlerDatei, "utf8")) : [];
    return { ...lauf, fehlermeldungen };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

export function gueltigePhase(phasendatei, root) {
  let phase;
  try {
    phase = ladePhase(phasendatei);
  } catch (fehler) {
    return { befunde: [`Die Phasendatei ${phasendatei} ist nicht lesbar: ${fehler.message}`] };
  }
  return { phase, befunde: phasenBefunde(phase, root) };
}

function gueltigerAuftrag(phasendatei, kennung, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  if (befunde.length > 0) return { befunde };
  const auftrag = phase.auftraege.find(({ id }) => id === kennung);
  return auftrag ? { phase, auftrag, befunde } : { befunde: [`Die Phase hat keinen Auftrag ${kennung}.`] };
}

function meldeBefunde(befunde) {
  for (const befund of befunde) console.error(befund);
  return EXIT_ROT;
}

export function pruefe(phasendatei, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  if (befunde.length > 0) {
    meldeBefunde(befunde);
    console.log(`rot: ${befunde.length} Befunde in ${phasendatei}.`);
    console.log(zweckBlock(MELDUNG.PHASENDATEI).join("\n"));
    return EXIT_ROT;
  }
  console.log(`grün: ${phase.auftraege.length} Aufträge in ${phasendatei} sind vollständig.`);
  return EXIT_GRUEN;
}

export function rot(phasendatei, kennung, root) {
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) return meldeBefunde(befunde);
  if (typeof auftrag.erwarteterFehler !== "string") {
    return meldeBefunde([`Auftrag ${kennung} ist ein Umbau und hat keinen roten Test.`]);
  }
  const lauf = abnahmeLauf(auftrag.abnahme, { cwd: root, env });
  console.log(gekuerzteTestausgabe(lauf.ausgabe));
  const urteil = rotUrteil(lauf, auftrag.erwarteterFehler);
  console.log(urteil.zeile);
  return urteil.rot ? EXIT_GRUEN : EXIT_ROT;
}

export function grenzen(phasendatei, kennung, { rolle, basis, root }) {
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) {
    console.log(`${VERSTOSS}${PHASE_PASST_NICHT}`);
    return meldeBefunde(befunde);
  }
  const aenderungen = aenderungenSeit(basis, root);
  const kontext = { auftrag, rolle, muster: geschuetzteMuster(root), bestand: (pfad) => gibtEsIn(basis, pfad, root) };
  const { verstoesse, hinweise, produktzeilen } = grenzBefunde(kontext, aenderungen);
  for (const zeile of [...verstoesse, ...hinweise]) console.log(zeile);
  const urteil = verstoesse.length === 0 ? "grün" : "rot";
  console.log(
    `${urteil}: ${aenderungen.length} Dateien geändert, ${produktzeilen} neue Zeilen Produktcode, Rolle ${rolle}.`,
  );
  return verstoesse.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

const HINZUGEFUEGT = /^\+(?!\+\+ )/;
const ZIELDATEI = /^\+\+\+ b\/(.+)$/;
const HUNK_KOPF = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const JS_DATEI = /\.[cm]?js$/;
const JAVASCRIPT = { ecmaVersion: "latest", sourceType: "module", loc: true };
const BEZEICHNER = "Identifier";

function vorgemerkteNeueZeilen(basis, root) {
  const diff = git(["-c", "core.quotePath=false", "diff", "--cached", "--unified=0", "--no-color", basis], { cwd: root }).split("\n");
  const jeDatei = new Map();
  let datei = "";
  let naechste = 0;
  for (const zeile of diff) {
    const ziel = ZIELDATEI.exec(zeile);
    const kopf = HUNK_KOPF.exec(zeile);
    if (ziel !== null) datei = ziel[1];
    else if (kopf !== null) naechste = Number(kopf[1]);
    else if (HINZUGEFUEGT.test(zeile)) jeDatei.set(datei, [...(jeDatei.get(datei) ?? []), naechste++]);
  }
  return [...jeDatei].map(([pfad, neu]) => ({ datei: pfad, neu, inhalt: git(["show", `:${pfad}`], { cwd: root }) }));
}

function bezeichnerJeZeile(inhalt) {
  const jeZeile = new Map();
  for (const { type, value, loc } of tokenize(inhalt, JAVASCRIPT)) {
    if (type === BEZEICHNER) jeZeile.set(loc.start.line, (jeZeile.get(loc.start.line) ?? new Set()).add(value));
  }
  return jeZeile;
}

function neueZeilenDer({ datei, inhalt, neu }) {
  const bezeichner = JS_DATEI.test(datei) ? bezeichnerJeZeile(inhalt) : new Map();
  const texte = inhalt.split("\n");
  return neu.map((nummer) => ({ datei, text: texte[nummer - 1], bezeichner: bezeichner.get(nummer) ?? new Set() }));
}

function lesbareZeilen(dateien) {
  const zeilen = [];
  const unlesbar = [];
  for (const datei of dateien) {
    try {
      zeilen.push(...neueZeilenDer(datei));
    } catch (fehler) {
      unlesbar.push(`nicht lesbar: ${datei.datei} ist kein lesbares JavaScript (${fehler.message})`);
    }
  }
  return { zeilen, unlesbar };
}

function deklarationsMuster(funktion) {
  const name = maskiert(funktion);
  return new RegExp(`(?:function\\*?\\s+|(?:const|let|var|class)\\s+)${name}(?![\\w$])|^\\s*(?:async\\s+|static\\s+)*${name}\\s*\\([^)]*\\)\\s*\\{`);
}

function verstossBei({ datei, funktion, fuer }, zeilen) {
  const deklariert = deklarationsMuster(funktion);
  const nachbau = zeilen.find((zeile) => zeile.datei !== datei && deklariert.test(zeile.text));
  if (nachbau !== undefined) return [`nachgebaut: ${nachbau.datei} deklariert ${funktion} neu, statt ${datei}:${funktion} zu nutzen (für ${fuer})`];
  const aufgerufen = zeilen.some((zeile) => zeile.bezeichner.has(funktion) && !deklariert.test(zeile.text));
  return aufgerufen ? [] : [`nicht genutzt: ${datei}:${funktion} (für ${fuer})`];
}

export function nutzungsVerstoesse(nutzen, dateien) {
  if (nutzen.length === 0) return [];
  const { zeilen, unlesbar } = lesbareZeilen(dateien);
  return [...unlesbar, ...nutzen.flatMap((eintrag) => verstossBei(eintrag, zeilen))];
}

export function genutzt(phasendatei, kennung, { basis, root }) {
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) return meldeBefunde(befunde);
  const nutzen = auftrag.nutzen ?? [];
  const verstoesse = nutzungsVerstoesse(nutzen, nutzen.length > 0 ? vorgemerkteNeueZeilen(basis, root) : []);
  for (const verstoss of verstoesse) console.log(`${VERSTOSS}${verstoss}`);
  const urteil = verstoesse.length === 0 ? `grün: ${nutzen.length} von ${nutzen.length} vorhandenen Funktionen in den neuen Zeilen genutzt.` : `rot: ${verstoesse.length} Verstöße bei ${nutzen.length} vorhandenen Funktionen in den neuen Zeilen.`;
  console.log(urteil);
  return verstoesse.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}
