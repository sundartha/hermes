import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { funktionskartePfad, istTestdatei } from "./format.mjs";
import { gekuerzteTestausgabe } from "./pruefungen.mjs";

const KRITISCH_SUFFIX = "-kritisch";
const JSON_EINRUECKUNG = 2;
const EXIT_OHNE_STATUS = 1;
const WAECHTER = fileURLToPath(new URL("waechter.mjs", import.meta.url));
const VERLAUF_AUSGABE = ["--output-format", "stream-json", "--verbose", "--include-hook-events"];
const GATE_TESTS = new URL("../gate-tests.json", import.meta.url);
const GATE_ANKER = "#";
const KRITISCH_OHNE_GATE_TEST = [
  "src/middleware.js",
  "src/boot-guard.js",
  "src/process-guards.js",
  "src/config.js",
  "src/turn-budget.js",
  "src/billing/",
  "src/llm-usage.js",
  "src/telephony/",
  "src/routes/voice.js",
  "src/routes/webhooks-",
  "src/worker/provisioning.js",
  "src/queue/",
  "src/plans.js",
  "src/elevenlabs/",
];

function gatePfade() {
  const gates = Object.values(JSON.parse(readFileSync(GATE_TESTS, "utf8")));
  return gates.flatMap(({ module, tests }) => [...module, ...tests]).map((pfad) => pfad.split(GATE_ANKER)[0]);
}

const KRITISCHE_PFADE = [...new Set([...gatePfade(), ...KRITISCH_OHNE_GATE_TEST])];

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

function geplanteTests(auftrag) {
  return (auftrag?.erwarteteDateien ?? []).filter(istTestdatei);
}

function geplanteTestsAbschnitt(auftrag, root) {
  const bestehende = geplanteTests(auftrag).filter((pfad) => existsSync(join(root, pfad)));
  if (bestehende.length === 0) return [];
  return [
    abschnitt("Geplante bestehende Testdateien", [
      ...bestehende.map((pfad) => `- ${pfad}`),
      "",
      "In diesen Testdateien passt du genau die Fälle an, deren Erwartung das neue Verhalten ändert.",
      "Jeder geänderte oder neue Fall ist gegen den unveränderten Produktcode rot, unveränderte Fälle bleiben grün.",
      "Reiner Umbau von Tests gehört nicht in diesen Schritt. An alle anderen bestehenden Testdateien hängst du nur an.",
    ].join("\n")),
  ];
}

export function testPrompt(phase, auftrag, root = cwd()) {
  return [auftragAbschnitt(auftrag), entwurfAbschnitt(phase, auftrag), ...geplanteTestsAbschnitt(auftrag, root)].join("\n");
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

function auswertung({ stdout, status, stderr }) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { exitCode: status ?? EXIT_OHNE_STATUS, antwort: "", fehlerausgabe: stderr ?? "" };
  }
}

function agentName(rolle, auftrag, start) {
  const bereich = auftrag?.bereich;
  if ((start.agent ?? "") === "" && bereich === undefined) throw new Error("Ohne Bereich braucht der Start einen Agenten.");
  return start.agent ?? agentFuer(rolle, bereich);
}

function vorbereitung({ rolle, auftrag, fortsetzung }, prompt, start) {
  const agent = agentName(rolle, auftrag, start);
  const sitzung = fortsetzung ?? randomUUID();
  const befehl = [
    env.HERMES_CLAUDE ?? "claude",
    "-p",
    "--agent",
    agent,
    ...(start.argumente ?? ["--settings", `.claude/rollen/${rolle}.json`]),
    fortsetzung ? "--resume" : "--session-id",
    sitzung,
    "--permission-mode",
    "acceptEdits",
    ...VERLAUF_AUSGABE,
  ];
  const erwartet = JSON.stringify(geplanteTests(auftrag));
  const umgebung = { ...env, HERMES_ROLLE: rolle, HERMES_ABNAHME: auftrag?.abnahme, HERMES_ERWARTET: erwartet };
  const daten = JSON.stringify({ befehl, eingabe: prompt, kontextGrenze: start.kontextGrenze, vollstaendig: start.vollstaendig });
  return { kopf: { rolle, agent, sitzung, befehl: befehl.join(" ") }, umgebung, daten };
}

export function starteAgent(kontext, prompt, start = {}) {
  const { kopf, umgebung, daten } = vorbereitung(kontext, prompt, start);
  const lauf = spawnSync(execPath, [WAECHTER], { cwd: kontext.root, env: umgebung, input: daten, encoding: "utf8" });
  return { ...kopf, ...auswertung(lauf) };
}

export function starteAgentParallel(kontext, prompt, start = {}) {
  const { kopf, umgebung, daten } = vorbereitung(kontext, prompt, start);
  const kind = spawn(execPath, [WAECHTER], { cwd: kontext.root, env: umgebung });
  const ausgabe = { stdout: "", stderr: "" };
  for (const kanal of ["stdout", "stderr"]) {
    kind[kanal].setEncoding("utf8");
    kind[kanal].on("data", (stueck) => {
      ausgabe[kanal] += stueck;
    });
  }
  kind.stdin.end(daten);
  return new Promise((fertig) => {
    kind.on("close", (status) => fertig({ ...kopf, ...auswertung({ ...ausgabe, status }) }));
  });
}
