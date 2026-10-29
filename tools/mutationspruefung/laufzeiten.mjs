import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { entferneTempOrdner, neuerTempOrdner } from "../temp-ordner.mjs";
import { zeilenAus } from "../testlaufzeit/ausklingen.mjs";
import { gh, ghRepo } from "./gh.mjs";

const WORKFLOW = "ci.yml";
const ARTEFAKTE = "testlaufzeit-teil-*";
const LAUFZEITDATEI = "dateien.jsonl";
const ORDNERPRAEFIX = "laufzeiten-";
const MELDUNG_ZEICHEN = 160;

export function rueckfallZeile(grund) {
  return `Mutationsplan: ohne Laufzeitdaten, reihum (${grund})`;
}

function ohneDaten(grund) {
  return { dauern: null, kennung: null, grund };
}

function gueltigeDauern(dauern) {
  const eintraege = typeof dauern === "object" && dauern !== null && !Array.isArray(dauern) ? Object.entries(dauern) : [];
  return Object.fromEntries(eintraege.filter(([, ms]) => Number.isFinite(ms) && ms >= 0).sort(([links], [rechts]) => (links < rechts ? -1 : 1)));
}

function tabelleAus(pfad) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch {
    return null;
  }
}

export function leseLaufzeiten(pfad) {
  if (pfad === undefined) return ohneDaten("keine Laufzeitdaten angegeben");
  const datei = resolve(pfad);
  if (!existsSync(datei)) throw new Error(`Laufzeitdatei fehlt: ${pfad}`);
  const tabelle = tabelleAus(datei);
  if (typeof tabelle !== "object" || tabelle === null) return ohneDaten("Laufzeitdatei unlesbar");
  const dauern = gueltigeDauern(tabelle.dauern);
  if (Object.keys(dauern).length === 0) return ohneDaten(typeof tabelle.grund === "string" && tabelle.grund !== "" ? tabelle.grund : "Tabelle leer");
  return { dauern, kennung: createHash("sha256").update(JSON.stringify(dauern)).digest("hex"), grund: null };
}

function neuesterLauf(repo) {
  const liste = JSON.parse(
    gh(["run", "list", "-R", repo, "--workflow", WORKFLOW, "--branch", "master", "--event", "push", "--status", "success", "--limit", "1", "--json", "databaseId"]),
  );
  return liste[0]?.databaseId;
}

function dauernAus(ordner) {
  const dauern = {};
  for (const name of readdirSync(ordner, { recursive: true }).filter((eintrag) => basename(eintrag) === LAUFZEITDATEI)) {
    for (const { datei, dauer_ms: ms } of zeilenAus(join(ordner, name))) {
      if (typeof datei === "string" && Number.isFinite(ms)) dauern[datei] = Math.max(dauern[datei] ?? 0, ms);
    }
  }
  return gueltigeDauern(dauern);
}

function abrufen(repo) {
  const lauf = neuesterLauf(repo);
  if (lauf === undefined) return { grund: "kein grüner Master-Lauf" };
  const ordner = neuerTempOrdner(ORDNERPRAEFIX);
  try {
    gh(["run", "download", String(lauf), "-R", repo, "-D", ordner, "-p", ARTEFAKTE]);
    const dauern = dauernAus(ordner);
    return Object.keys(dauern).length === 0 ? { grund: `keine Laufzeiten im Lauf ${lauf}` } : { lauf, dauern };
  } finally {
    entferneTempOrdner(ordner);
  }
}

function abgerufen() {
  try {
    return abrufen(ghRepo());
  } catch (fehler) {
    return { grund: `Abruf fehlgeschlagen: ${String(fehler.message).replace(/\s+/g, " ").slice(0, MELDUNG_ZEICHEN)}` };
  }
}

export function holeLaufzeiten(ziel) {
  const { lauf, dauern, grund } = abgerufen();
  const tabelle = dauern ? { lauf, dauern } : { lauf: null, grund, dauern: {} };
  writeFileSync(ziel, JSON.stringify(tabelle) + "\n");
  return dauern ? `Mutationsplan: Laufzeiten aus Lauf ${lauf}, ${Object.keys(dauern).length} Testdateien` : `Mutationsplan: keine Laufzeiten geholt (${grund})`;
}
