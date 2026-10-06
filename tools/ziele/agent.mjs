import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import {
  CLI_PFAD,
  LIMIT_GRUND,
  REGELN,
  TOKEN_GRUND,
  alsObjekt,
  starteMitFrist,
  verbrauch,
} from "../auftrag/pruefer-lauf.mjs";
import { WERKZEUG_ROOT } from "./werkzeuge.mjs";

const BUDGET_DATEI = ".github/budget.json";
const MS_JE_SEKUNDE = 1000;
const SEKUNDEN_JE_MINUTE = 60;
export const RESERVE_SEKUNDEN = 240;
export const MIN_AGENT_SEKUNDEN = 60;
const ERGEBNIS = "result";

export function budgetMinuten(root, name) {
  try {
    const { minutenJeLauf } = JSON.parse(readFileSync(join(root, BUDGET_DATEI), "utf8"));
    const minuten = minutenJeLauf?.[name];
    return Number.isFinite(minuten) && minuten > 0 ? minuten : null;
  } catch {
    return null;
  }
}

export function restSekunden(minuten, { start, jetzt, reserve = RESERVE_SEKUNDEN }) {
  const verbraucht = (jetzt - Date.parse(start)) / MS_JE_SEKUNDE;
  return Math.floor(minuten * SEKUNDEN_JE_MINUTE - verbraucht - reserve);
}

export function budgetFehlt(name) {
  return `in ${BUDGET_DATEI} fehlt minutenJeLauf["${name}"]; ohne Zeitgrenze startet kein Agent`;
}

export function nimmToken() {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN ?? "";
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return token;
}

export function agentBefehl({ werkzeuge, erlaubt, modell, schema, prompt }) {
  const programm = env.HERMES_CLAUDE ?? join(WERKZEUG_ROOT, CLI_PFAD);
  return [
    programm,
    "-p",
    "--restricted",
    "--tools",
    werkzeuge,
    ...erlaubt.flatMap((regel) => ["--allowedTools", regel]),
    "--disallowedTools",
    "mcp__*",
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--model",
    modell,
    "--effort",
    "medium",
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(schema),
    "--append-system-prompt",
    readFileSync(join(WERKZEUG_ROOT, prompt), "utf8").trim(),
    "--no-session-persistence",
  ];
}

function ersterGrund(lage) {
  for (const regel of REGELN) {
    const grund = regel(lage);
    if (grund) return grund;
  }
  return "";
}

export function werteLaufAus(lauf, { token, pruefeAntwort }) {
  const ereignisse = lauf.zeilen.map(alsObjekt).filter(Boolean);
  const ergebnis = ereignisse.findLast((ereignis) => ereignis.type === ERGEBNIS) ?? null;
  const antwort = ergebnis ? pruefeAntwort(ergebnis.structured_output) : null;
  const lage = { ...lauf, ereignisse, ergebnis, befunde: antwort, token };
  const grund = ersterGrund(lage);
  const zaehler = { tokens: verbrauch(ergebnis), zuege: Number(ergebnis?.num_turns) || 0 };
  return { grund, antwort: grund ? null : antwort, ...zaehler };
}

export async function starteAgent({ root, befehl, eingabe, sekunden, token, pruefeAntwort }) {
  if (!token) return { grund: TOKEN_GRUND, antwort: null, tokens: 0, zuege: 0 };
  const home = mkdtempSync(join(tmpdir(), "ziele-home-"));
  try {
    const lauf = await starteMitFrist(befehl, {
      cwd: root,
      umgebung: { PATH: env.PATH, HOME: home, CLAUDE_CODE_OAUTH_TOKEN: token },
      eingabe,
      zeitgrenzeMs: sekunden * MS_JE_SEKUNDE,
    });
    return werteLaufAus(lauf, { token, pruefeAntwort });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function istWartend(grund) {
  return grund === LIMIT_GRUND;
}
