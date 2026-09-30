import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { funktionskartePfad } from "./format.mjs";
import { fuehreAus, gekuerzteTestausgabe } from "./pruefungen.mjs";

const MS_JE_MINUTE = 60_000;
const AGENT_ZEITLIMIT_MINUTEN = 45;
const KRITISCH_SUFFIX = "-kritisch";
const JSON_EINRUECKUNG = 2;
const MAX_ANTWORT_ZEICHEN = 1000;
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

function schlussantwort(ausgabe) {
  const zeilen = ausgabe.split("\n").reverse();
  for (const zeile of zeilen) {
    try {
      const { result: ergebnis } = JSON.parse(zeile);
      if (typeof ergebnis === "string") return ergebnis.slice(-MAX_ANTWORT_ZEICHEN);
    } catch {
      continue;
    }
  }
  return ausgabe.slice(-MAX_ANTWORT_ZEICHEN);
}

export function starteAgent({ rolle, auftrag, root }, prompt) {
  const agent = agentFuer(rolle, auftrag.bereich);
  const sitzung = randomUUID();
  const befehl = [
    env.HERMES_CLAUDE ?? "claude",
    "-p",
    "--agent",
    agent,
    "--settings",
    `.claude/rollen/${rolle}.json`,
    "--session-id",
    sitzung,
    "--permission-mode",
    "acceptEdits",
    "--output-format",
    "json",
  ];
  const lauf = fuehreAus(`agent ${rolle}`, befehl, {
    cwd: root,
    env: { ...env, HERMES_ROLLE: rolle, HERMES_ABNAHME: auftrag.abnahme },
    zeitlimit: AGENT_ZEITLIMIT_MINUTEN * MS_JE_MINUTE,
    eingabe: prompt,
  });
  return {
    rolle,
    agent,
    sitzung,
    befehl: befehl.join(" "),
    exitCode: lauf.exitCode,
    antwort: schlussantwort(lauf.ausgabe),
  };
}
