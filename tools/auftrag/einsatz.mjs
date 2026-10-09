import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pid } from "node:process";

import { starteAgent } from "./agenten.mjs";
import { git } from "./git.mjs";
import { UEBERGABE } from "./verlauf.mjs";

const MS_JE_MINUTE = 60_000;
const WARTEZEIT_OHNE_ANGABE_MINUTEN = 30;
const VORAUSSETZUNG = /^Voraussetzung fehlt:\s*(\S.*)$/m;
const AUSSTIEG = /^Auftrag passt nicht:\s*(\S.*)$/m;
const BAU = "bau";
const MIT_AUSSTIEG = new Set([BAU, "test"]);
const LESE_WERKZEUGE = ["Read", "Grep", "Glob"];
const LESE_MODELL = "opus";
const OHNE_HOOKS = JSON.stringify({ disableAllHooks: true });
const LIMIT_SPERREN = "auftrag-limit";
const SCHLAEFER = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
const ERGEBNIS_DES_BAUS = [
  "",
  "## Wenn eine Voraussetzung fehlt",
  "",
  "Geht der Auftrag nur, wenn vorher etwas außerhalb seines Bereichs geändert wird, hörst du auf und antwortest als Letztes mit genau einer Zeile:",
  "Voraussetzung fehlt: <ein Satz, was vorher passieren muss>",
  "",
].join("\n");

function limitSperre({ root, phase }) {
  const gemeinsam = git(["rev-parse", "--git-common-dir"], { cwd: root }).trim();
  return join(resolve(root, gemeinsam), LIMIT_SPERREN, phase.phase);
}

function restDerSperre(sperre) {
  const bis = existsSync(sperre) ? Number(readFileSync(sperre, "utf8")) : 0;
  return bis - Date.now();
}

function warteAufFreigabe(sperre) {
  let rest = restDerSperre(sperre);
  while (rest > 0) {
    Atomics.wait(SCHLAEFER, 0, 0, rest);
    rest = restDerSperre(sperre);
  }
}

function sperreWegenLimit(sperre, { bis }) {
  const jetzt = Date.now();
  const gemeldet = bis > jetzt ? bis : jetzt + WARTEZEIT_OHNE_ANGABE_MINUTEN * MS_JE_MINUTE;
  const frei = Math.max(jetzt + restDerSperre(sperre), gemeldet);
  const entwurf = `${sperre}.${pid}`;
  mkdirSync(dirname(sperre), { recursive: true });
  writeFileSync(entwurf, String(frei));
  renameSync(entwurf, sperre);
  return `Nutzungslimit erreicht; das Skript startet neue Agenten erst ab ${new Date(frei).toISOString()} und macht dann weiter.`;
}

function uebergabe(vorgaenger) {
  if (vorgaenger === null) return "";
  return [
    "",
    "## Übergabe",
    "",
    `Ein früherer Agent hat an diesem Auftrag gearbeitet. Das Skript hat ihn beendet. Grund: ${vorgaenger.grund}`,
    "Seine Änderungen liegen unverändert im Arbeitsbaum; `git status` und `git diff` zeigen sie. Seine letzte Nachricht:",
    "",
    vorgaenger.antwort,
    "",
  ].join("\n");
}

function grundDerSitzung({ limit, aktion }, { auftrag, sperre }) {
  if (!limit) return aktion?.grund ?? null;
  const grund = sperreWegenLimit(sperre, limit);
  console.log(`Auftrag ${auftrag.id}: ${grund}`);
  return grund;
}

function voraussetzung({ rolle, antwort = "" }) {
  return rolle === BAU ? (VORAUSSETZUNG.exec(antwort)?.[1] ?? null) : null;
}

function ausstieg({ rolle, antwort = "" }) {
  return MIT_AUSSTIEG.has(rolle) ? (AUSSTIEG.exec(antwort)?.[1] ?? null) : null;
}

export function setzeEin(kontext, prompt, start) {
  const auftragsPrompt = kontext.rolle === BAU ? `${prompt}${ERGEBNIS_DES_BAUS}` : prompt;
  const sperre = limitSperre(kontext);
  const sitzungen = [];
  let vorgaenger = null;
  let pruefleiter;
  for (;;) {
    warteAufFreigabe(sperre);
    const fortsetzung = vorgaenger === null ? kontext.fortsetzung : undefined;
    const sitzung = starteAgent({ ...kontext, pruefleiter, fortsetzung }, `${auftragsPrompt}${uebergabe(vorgaenger)}`, start);
    const grund = grundDerSitzung(sitzung, { auftrag: kontext.auftrag, sperre });
    sitzungen.push(grund ? { ...sitzung, grund } : sitzung);
    if (!sitzung.limit && sitzung.aktion?.art !== UEBERGABE) {
      return { ...sitzung, grund, sitzungen, voraussetzung: voraussetzung(sitzung), ausstieg: ausstieg(sitzung) };
    }
    vorgaenger = { grund, antwort: sitzung.antwort };
    pruefleiter = sitzung.pruefleiter;
  }
}

export function frage(kontext, prompt) {
  const definition = {
    [kontext.rolle]: {
      description: "Liest das Repo und antwortet mit Text; ändert nichts.",
      prompt: "Du liest nur und antwortest mit Text. Du änderst keine Datei und führst keine Befehle aus.",
      tools: LESE_WERKZEUGE,
      model: LESE_MODELL,
    },
  };
  const argumente = ["--agents", JSON.stringify(definition), "--settings", OHNE_HOOKS, "--tools", LESE_WERKZEUGE.join(",")];
  return setzeEin(kontext, prompt, { agent: kontext.rolle, argumente });
}
