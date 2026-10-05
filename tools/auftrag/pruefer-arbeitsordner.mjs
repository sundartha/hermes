import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { gitAusgabe } from "./pruefer-auswahl.mjs";
import { ersetzeSteuerzeichen } from "./pruefer-schema.mjs";

export const WERKZEUG_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const KEIN_AUFTRAGSZETTEL = "kein Auftragszettel gefunden";
const REFERENZEN = new Map([
  ["clean-code.md", ".claude/refs/clean-code.md"],
  ["clean-code-pruefer.md", ".claude/refs/clean-code-pruefer.md"],
  ["sicherheitsgrenzen.md", "docs/sicherheitsgrenzen.md"],
]);
const HEIKLER_NAME = /^(?:\.|claude|agents\.md$)/i;
const UNGUELTIGES_SEGMENT = new Set(["", ".", ".."]);
const MIN_STELLEN = 3;
const NUR_LESEN = 0o444;

function sichererPfad(pfad) {
  if (pfad.startsWith("/") || ersetzeSteuerzeichen(pfad, "") !== pfad) return null;
  const segmente = pfad.split("/");
  if (segmente.some((segment) => UNGUELTIGES_SEGMENT.has(segment))) return null;
  return segmente
    .map((segment) => (HEIKLER_NAME.test(segment) ? `_${segment}` : segment))
    .join("/");
}

function nummer(index, anzahl) {
  return String(index + 1).padStart(Math.max(MIN_STELLEN, String(anzahl).length), "0");
}

function schreibe(datei, inhalt) {
  mkdirSync(dirname(datei), { recursive: true });
  writeFileSync(datei, inhalt, { flag: "wx", mode: NUR_LESEN });
}

function inhaltNachCommit(sha, pfad, root) {
  try {
    return gitAusgabe(["show", `${sha}:${pfad}`], root, { kodierung: "buffer" });
  } catch {
    return null;
  }
}

function patchVon(sha, pfad, root) {
  const args = [
    "--literal-pathspecs",
    "show",
    "--format=",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    sha,
    "--",
    pfad,
  ];
  return gitAusgabe(args, root, { kodierung: "buffer" });
}

function legeDateiAb(ordner, { sha, pfad, root }) {
  const ziel = sichererPfad(pfad);
  if (ziel === null) return { ablage: null, grund: "Pfad verworfen" };
  const inhalt = inhaltNachCommit(sha, pfad, root);
  if (inhalt === null) return { ablage: null, grund: "nach dem Commit nicht vorhanden" };
  const datei = resolve(ordner, "dateien", ziel);
  if (!datei.startsWith(join(ordner, "dateien") + sep))
    return { ablage: null, grund: "Pfad verworfen" };
  try {
    schreibe(datei, inhalt);
  } catch {
    return { ablage: null, grund: "nicht ablegbar" };
  }
  return { ablage: `dateien/${ziel}`, grund: "" };
}

function dateiZeile({ patch, pfad, ablage, grund }) {
  const ziel = ablage ?? `kein Inhalt (${grund})`;
  return `- ${patch}: ${JSON.stringify(pfad)} → ${ziel}`;
}

function auftragsText(commit, { auftragstext }, eintraege) {
  return [
    "# Auftragszettel",
    "",
    `## Commit ${commit.sha}`,
    "",
    commit.nachricht.trimEnd(),
    "",
    "## Auftrag",
    "",
    (auftragstext || KEIN_AUFTRAGSZETTEL).trimEnd(),
    "",
    "## Geänderte Dateien",
    "",
    ...eintraege.map(dateiZeile),
    "",
  ].join("\n");
}

function ergebnisseText({ ciLauf }) {
  return [
    "# Ergebnisse der Prüfbefehle",
    "",
    "CI-Lauf: grün",
    `Adresse: ${ciLauf || "unbekannt"}`,
    "",
  ].join("\n");
}

function legeReferenzenAb(ordner) {
  for (const [name, quelle] of REFERENZEN) {
    schreibe(join(ordner, "refs", name), readFileSync(join(WERKZEUG_ROOT, quelle)));
  }
}

export function neuerOrdner(praefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), praefix)));
}

export function baueArbeitsordner(commit, kontext) {
  const ordner = neuerOrdner("pruefer-");
  const eintraege = commit.dateien.map((pfad, index) => {
    const patch = `diff/${nummer(index, commit.dateien.length)}.patch`;
    schreibe(join(ordner, patch), patchVon(commit.sha, pfad, kontext.root));
    return { patch, pfad, ...legeDateiAb(ordner, { sha: commit.sha, pfad, root: kontext.root }) };
  });
  legeReferenzenAb(ordner);
  schreibe(join(ordner, "auftrag.md"), auftragsText(commit, kontext, eintraege));
  schreibe(join(ordner, "ergebnisse.md"), ergebnisseText(kontext));
  return { ordner, patches: eintraege.map(({ patch }) => patch) };
}

export function entferne(ordner) {
  rmSync(ordner, { recursive: true, force: true });
}
