import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "node:process";
import { createInterface } from "node:readline";

import {
  WERKZEUG_ROOT,
  baueArbeitsordner,
  entferne,
  neuerOrdner,
} from "./pruefer-arbeitsordner.mjs";
import {
  ANTWORT_SCHEMA,
  GEPRUEFT,
  NICHT_GELAUFEN,
  SCHWEREN,
  UNVOLLSTAENDIG,
  befundeDerAntwort,
  gekuerzt,
} from "./pruefer-schema.mjs";

export const CLI_PFAD = "tools/pruefer/node_modules/@anthropic-ai/claude-code-linux-x64/claude";
const AGENT_DATEI = ".claude/agents/pruefer.md";
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
const GRUNDZUEGE = 10;
const ZUEGE_JE_DATEI = 4;
const MS_JE_ZUG = 120_000;
const EXIT_OHNE_STATUS = 1;
const MAX_ZEILEN = 100_000;
export const LIMIT_GRUND = "Nutzungslimit erreicht";
export const ANMELDUNG_GRUND = "Anmeldung gescheitert (authentication_failed)";
export const TOKEN_GRUND = "Token fehlt";
const LIMIT = /limit/i;
const ANMELDUNG = /authenticat|oauth token/i;
const SUBTYPE = /^[a-z_]+$/;
const ABGELEHNT = "rejected";
const TOKEN_FELDER = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
];
const LESE_WERKZEUGE = "Read,Grep,Glob";

export function zuegeFuer(commit) {
  return GRUNDZUEGE + ZUEGE_JE_DATEI * commit.dateien.length;
}

export function effortFuer(commit) {
  return commit.kritisch ? "max" : "medium";
}

function agentenText() {
  return readFileSync(join(WERKZEUG_ROOT, AGENT_DATEI), "utf8").replace(FRONTMATTER, "").trim();
}

export function prueferBefehl(commit, programm) {
  return [
    programm,
    "-p",
    "--restricted",
    "--tools",
    LESE_WERKZEUGE,
    "--disallowedTools",
    "mcp__*",
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--model",
    "opus",
    "--effort",
    effortFuer(commit),
    "--max-turns",
    String(zuegeFuer(commit)),
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(ANTWORT_SCHEMA),
    "--append-system-prompt",
    agentenText(),
    "--no-session-persistence",
  ];
}

function auftragFuerPruefer(commit, patches) {
  return [
    `Prüfe den Commit ${commit.sha}. Alle Eingaben liegen im Arbeitsordner: auftrag.md, ergebnisse.md, refs/, diff/ und dateien/.`,
    `Öffne jede dieser Dateien mit Read: ${patches.join(", ")}.`,
    "Antworte mit dem JSON nach dem vorgegebenen Schema.",
    "",
  ].join("\n");
}

function beende(kind) {
  try {
    process.kill(-kind.pid, "SIGKILL");
  } catch {
    return false;
  }
  return true;
}

export async function starteMitFrist(befehl, { cwd, umgebung, eingabe = "", zeitgrenzeMs }) {
  const [programm, ...argumente] = befehl;
  const kind = spawn(programm, argumente, {
    cwd,
    env: umgebung,
    detached: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const zeilen = [];
  createInterface({ input: kind.stdout }).on(
    "line",
    (zeile) => zeilen.length < MAX_ZEILEN && zeilen.push(zeile),
  );
  kind.stdin.on("error", () => false);
  kind.stdin.end(eingabe);
  const uhr = { abgelaufen: false };
  const wecker = setTimeout(() => {
    uhr.abgelaufen = beende(kind);
  }, zeitgrenzeMs);
  const exitCode = await new Promise((fertig) => {
    kind.on("error", () => fertig(EXIT_OHNE_STATUS));
    kind.on("close", (code) => fertig(code ?? EXIT_OHNE_STATUS));
  });
  clearTimeout(wecker);
  return { zeilen, exitCode, zeitAbgelaufen: uhr.abgelaufen };
}

function alsObjekt(zeile) {
  try {
    const wert = JSON.parse(zeile);
    return wert !== null && typeof wert === "object" ? wert : null;
  } catch {
    return null;
  }
}

function inhaltsTeile(ereignis) {
  const inhalt = ereignis.message?.content;
  return Array.isArray(inhalt) ? inhalt : [];
}

function teileVom(ereignisse, typ, teilTyp) {
  return ereignisse
    .filter((ereignis) => ereignis.type === typ)
    .flatMap(inhaltsTeile)
    .filter((teil) => teil?.type === teilTyp);
}

function geleseneDateien(ereignisse, ordner) {
  const erfolgreich = new Set(
    teileVom(ereignisse, "user", "tool_result")
      .filter((teil) => teil.is_error !== true)
      .map((teil) => teil.tool_use_id),
  );
  const lesen = teileVom(ereignisse, "assistant", "tool_use").filter(
    (teil) =>
      teil.name === "Read" && typeof teil.input?.file_path === "string" && erfolgreich.has(teil.id),
  );
  return new Set(lesen.map((teil) => resolve(ordner, teil.input.file_path)));
}

function limitErreicht({ ereignisse, ergebnis }) {
  const abgelehnt = ereignisse.some((ereignis) => ereignis.rate_limit_info?.status === ABGELEHNT);
  const fehler = ereignisse.some((ereignis) => ereignis.error === "rate_limit");
  const gemeldet = ergebnis?.is_error === true && ergebnis.subtype !== "error_max_turns";
  return abgelehnt || fehler || (gemeldet && LIMIT.test(String(ergebnis.result ?? "")));
}

function anmeldungGescheitert({ ereignisse, ergebnis }) {
  const fehler = ereignisse.some((ereignis) => ereignis.error === "authentication_failed");
  return fehler || (ergebnis?.is_error === true && ANMELDUNG.test(String(ergebnis.result ?? "")));
}

function laufFehler({ ergebnis }) {
  if (ergebnis.subtype === "error_max_turns") return "Züge aufgebraucht";
  if (ergebnis.is_error !== true && ergebnis.subtype === "success") return null;
  const art = SUBTYPE.test(String(ergebnis.subtype)) ? ergebnis.subtype : "unbekannt";
  return `Fehler im Lauf (${art})`;
}

const REGELN = [
  ({ zeitAbgelaufen }) => (zeitAbgelaufen ? "Zeitablauf" : null),
  (lage) => (limitErreicht(lage) ? LIMIT_GRUND : null),
  (lage) => (anmeldungGescheitert(lage) ? ANMELDUNG_GRUND : null),
  ({ ergebnis, exitCode }) => (ergebnis ? null : `kein Ergebnis (Exit ${exitCode})`),
  laufFehler,
  ({ befunde }) => (befunde ? null : "ungültige Antwort"),
  ({ befunde, token }) =>
    token && JSON.stringify(befunde).includes(token) ? "Antwort enthielt das Token" : null,
];

function verbrauch(ergebnis) {
  const nutzung = ergebnis?.usage ?? {};
  return TOKEN_FELDER.reduce((summe, feld) => summe + (Number(nutzung[feld]) || 0), 0);
}

function zaehlerDer(befunde, ergebnis) {
  const jeSchwere = Object.fromEntries(
    SCHWEREN.map((schwere) => [
      schwere,
      befunde.filter((befund) => befund.schwere === schwere).length,
    ]),
  );
  return { ...jeSchwere, tokens: verbrauch(ergebnis), zuege: Number(ergebnis?.num_turns) || 0 };
}

export function werteAus(lauf, { ordner, patches, token }) {
  const ereignisse = lauf.zeilen.map(alsObjekt).filter(Boolean);
  const ergebnis = ereignisse.findLast((ereignis) => ereignis.type === "result") ?? null;
  const befunde = ergebnis ? befundeDerAntwort(ergebnis.structured_output) : null;
  const lage = { ...lauf, ereignisse, ergebnis, befunde, token };
  for (const regel of REGELN) {
    const grund = regel(lage);
    if (grund)
      return { zustand: NICHT_GELAUFEN, grund, befunde: [], zaehler: zaehlerDer([], ergebnis) };
  }
  const gelesen = geleseneDateien(ereignisse, ordner);
  const offen = patches.filter((patch) => !gelesen.has(join(ordner, patch)));
  const zaehler = zaehlerDer(befunde, ergebnis);
  if (offen.length > 0)
    return {
      zustand: UNVOLLSTAENDIG,
      grund: `nicht gelesen: ${offen.join(", ")}`,
      befunde: [],
      zaehler,
    };
  return { zustand: GEPRUEFT, grund: "", befunde: befunde.map(gekuerzt), zaehler };
}

function eintrag(commit, auswertung) {
  const { sha, patchId, kritisch } = commit;
  return { sha, patchId, kritisch, uebernommen: false, ...auswertung };
}

async function rufeAuf(commit, kontext) {
  const { ordner, patches } = baueArbeitsordner(commit, kontext);
  const home = neuerOrdner("pruefer-home-");
  try {
    const umgebung = { PATH: env.PATH, HOME: home, CLAUDE_CODE_OAUTH_TOKEN: kontext.token };
    const programm = kontext.programm ?? env.HERMES_CLAUDE ?? join(WERKZEUG_ROOT, CLI_PFAD);
    const lauf = await starteMitFrist(prueferBefehl(commit, programm), {
      cwd: ordner,
      umgebung,
      eingabe: auftragFuerPruefer(commit, patches),
      zeitgrenzeMs: zuegeFuer(commit) * MS_JE_ZUG,
    });
    return werteAus(lauf, { ordner, patches, token: kontext.token });
  } finally {
    entferne(ordner);
    entferne(home);
  }
}

export function nichtGelaufen(commit, grund) {
  return eintrag(commit, {
    zustand: NICHT_GELAUFEN,
    grund,
    befunde: [],
    zaehler: zaehlerDer([], null),
  });
}

export async function pruefeCommit(commit, kontext) {
  if (commit.dateien.length === 0) {
    return eintrag(commit, {
      zustand: GEPRUEFT,
      grund: "keine Änderung",
      befunde: [],
      zaehler: zaehlerDer([], null),
    });
  }
  if (!kontext.token) return nichtGelaufen(commit, TOKEN_GRUND);
  return eintrag(commit, await rufeAuf(commit, kontext));
}
