import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { funktionskartePfad } from "./format.mjs";
import { gekuerzteTestausgabe } from "./pruefungen.mjs";

const KRITISCH_SUFFIX = "-kritisch";
const JSON_EINRUECKUNG = 2;
const EXIT_OHNE_STATUS = 1;
const WAECHTER = fileURLToPath(new URL("waechter.mjs", import.meta.url));
const VERLAUF_AUSGABE = ["--output-format", "stream-json", "--verbose", "--include-hook-events"];
const KRITISCHE_PFADE = [
  "src/auth.js",
  "src/web-auth.js",
  "src/middleware.js",
  "src/route-policy.js",
  "src/boot-guard.js",
  "src/process-guards.js",
  "src/callee-is-owner.js",
  "src/config.js",
  "src/budget-gate.js",
  "src/turn-budget.js",
  "src/claude.js",
  "src/billing/",
  "src/llm-usage.js",
  "src/telephony/",
  "src/routes/voice.js",
  "src/routes/webhooks-",
  "src/worker/provisioning.js",
  "src/queue/",
];

export function istKritisch(bereich) {
  return KRITISCHE_PFADE.some((pfad) => bereich.startsWith(pfad) || pfad.startsWith(bereich));
}

export function agentFuer(rolle, bereich) {
  return istKritisch(bereich) ? `${rolle}${KRITISCH_SUFFIX}` : rolle;
}

function abschnitt(titel, inhalt) {
  return `## ${titel}\n\n${inhalt.trimEnd()}\n`;
}

function block(inhalt, sprache = "") {
  return `\`\`\`${sprache}\n${inhalt.trimEnd()}\n\`\`\``;
}

function auftragAbschnitt(auftrag) {
  return abschnitt("Auftrag", block(JSON.stringify(auftrag, null, JSON_EINRUECKUNG), "json"));
}

function entwurfAbschnitt(phase, auftrag) {
  return abschnitt(`Entwurf für ${auftrag.bereich}`, phase.entwurf[auftrag.bereich]);
}

export function testPrompt(phase, auftrag) {
  return [auftragAbschnitt(auftrag), entwurfAbschnitt(phase, auftrag)].join("\n");
}

function dateiAbschnitt(titel, root, pfad) {
  const datei = join(root, pfad);
  if (!existsSync(datei)) return abschnitt(titel, `${pfad} gibt es noch nicht.`);
  return abschnitt(`${titel}: ${pfad}`, block(readFileSync(datei, "utf8")));
}

export function bauPrompt({ phase, auftrag, root }, testausgabe) {
  const titel = auftrag.erwarteterFehler ? "Ausgabe des roten Tests" : "Ausgabe des Abnahmetests";
  return [
    auftragAbschnitt(auftrag),
    entwurfAbschnitt(phase, auftrag),
    abschnitt(titel, block(gekuerzteTestausgabe(testausgabe))),
    dateiAbschnitt("Vorbild", root, auftrag.vorbild),
    dateiAbschnitt("Funktionskarte", root, funktionskartePfad(auftrag.bereich)),
  ].join("\n");
}

function beobachte(befehl, { root, umgebung, eingabe, auftrag, pruefleiter }) {
  const daten = JSON.stringify({ befehl, eingabe, auftrag, pruefleiter });
  const lauf = spawnSync(execPath, [WAECHTER], { cwd: root, env: umgebung, input: daten, encoding: "utf8" });
  try {
    return JSON.parse(lauf.stdout);
  } catch {
    return { exitCode: lauf.status ?? EXIT_OHNE_STATUS, antwort: "", fehlerausgabe: lauf.stderr ?? "" };
  }
}

export function starteAgent({ rolle, auftrag, root, pruefleiter }, prompt, start = {}) {
  const agent = start.agent ?? agentFuer(rolle, auftrag.bereich);
  const sitzung = randomUUID();
  const befehl = [
    env.HERMES_CLAUDE ?? "claude",
    "-p",
    "--agent",
    agent,
    ...(start.argumente ?? ["--settings", `.claude/rollen/${rolle}.json`]),
    "--session-id",
    sitzung,
    "--permission-mode",
    "acceptEdits",
    ...VERLAUF_AUSGABE,
  ];
  const umgebung = { ...env, HERMES_ROLLE: rolle, HERMES_ABNAHME: auftrag.abnahme };
  const lauf = beobachte(befehl, { root, umgebung, eingabe: prompt, auftrag, pruefleiter });
  return { rolle, agent, sitzung, befehl: befehl.join(" "), ...lauf };
}
