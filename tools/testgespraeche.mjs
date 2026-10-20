import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { zweckBlock } from "./auftrag/zweck.mjs";
import { pruefeBestueckung, pruefeVariablen, pushFelder } from "./testgespraeche/bestueckung.mjs";
import { bewerte, promptUeberschriften } from "./testgespraeche/bewertung.mjs";
import { fuehreAus, holeAgent } from "./testgespraeche/elevenlabs.mjs";
import { ladeFaelle, variablenVon } from "./testgespraeche/faelle.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const FESTE_FAELLE = join(REPO_ROOT, "elevenlabs/testgespraeche/feste-faelle.json");
const VORLAGE = join(REPO_ROOT, "elevenlabs/agent_configs/outbound-agent.template.json");
const LIVE_AGENT_ID = "agent_5301kwkh9vv3ezesf100pggfj9rs";
const MINDEST_WIEDERHOLUNGEN = 5;
const HOECHST_WIEDERHOLUNGEN = 50;
const STANDARD_FRIST_S = 1800;
const STANDARD_TAKT_MS = 5000;
const MS_JE_S = 1000;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_FEHLER = 2;
const ZWECK = "uebrige/testgespraeche";
const OPTIONEN = {
  agent: { type: "string" },
  fall: { type: "string", multiple: true, default: [] },
  wiederholungen: { type: "string", default: String(MINDEST_WIEDERHOLUNGEN) },
  "frist-s": { type: "string", default: String(STANDARD_FRIST_S) },
  "takt-ms": { type: "string", default: String(STANDARD_TAKT_MS) },
  plan: { type: "boolean", default: false },
  "push-felder": { type: "boolean", default: false },
};

function ganzzahl(wert, name) {
  const zahl = Number(wert);
  if (!Number.isInteger(zahl) || zahl < 0) throw new Error(`--${name} keine ganze Zahl ist`);
  return zahl;
}

function wiederholungenAus(wert) {
  const zahl = ganzzahl(wert, "wiederholungen");
  if (zahl < MINDEST_WIEDERHOLUNGEN || zahl > HOECHST_WIEDERHOLUNGEN) {
    throw new Error(
      `--wiederholungen zwischen ${MINDEST_WIEDERHOLUNGEN} und ${HOECHST_WIEDERHOLUNGEN} liegen muss`,
    );
  }
  return zahl;
}

function agentAus(agent) {
  if (!agent) throw new Error("--agent fehlt (die ID des Staging-Agenten)");
  if (agent === LIVE_AGENT_ID) throw new Error("Testgespräche nie gegen den Live-Agenten laufen");
  return agent;
}

function vorlage() {
  return JSON.parse(readFileSync(VORLAGE, "utf8"));
}

function ueberschriften() {
  const { prompt } = vorlage().agent.conversation_config.agent;
  return promptUeberschriften(prompt.prompt);
}

function zeile(ergebnis) {
  const gruende = ergebnis.gruende.length === 0 ? "–" : ergebnis.gruende.join("; ");
  return `| ${ergebnis.name} | ${ergebnis.bestanden} von ${ergebnis.gesamt} | ${gruende} |`;
}

function bericht(ergebnis, { agent, wiederholungen, credits }) {
  return [
    "## Testgespräche",
    "",
    `Agent: ${agent}, Läufe je Fall: ${wiederholungen}`,
    "",
    "| Fall | bestanden | Gründe |",
    "| --- | --- | --- |",
    ...ergebnis.faelle.map(zeile),
    "",
    `Ergebnis: ${ergebnis.gruen ? "grün" : "rot"}`,
    `Credits laut ElevenLabs: ${credits}`,
    "",
  ].join("\n");
}

function plan(faelle, wiederholungen) {
  const namen = faelle.map((fall) => fall.name).join(", ");
  return `${faelle.length} Fälle (${namen}) mit je ${wiederholungen} Läufen: ${faelle.length * wiederholungen} simulierte Gespräche.\n`;
}

async function main() {
  const { values } = parseArgs({ options: OPTIONEN });
  if (values["push-felder"]) {
    stdout.write(`--felder=${pushFelder(vorlage()).join(",")}\n`);
    return EXIT_GRUEN;
  }
  const wiederholungen = wiederholungenAus(values.wiederholungen);
  const faelle = ladeFaelle(FESTE_FAELLE, values.fall);
  if (values.plan) {
    stdout.write(plan(faelle, wiederholungen));
    return EXIT_GRUEN;
  }
  const agent = agentAus(values.agent);
  const live = await holeAgent(agent);
  pruefeVariablen(live, faelle, variablenVon);
  pruefeBestueckung(vorlage(), live);
  const laeufe = await fuehreAus({
    agent,
    faelle,
    variablenVon,
    wiederholungen,
    frist: ganzzahl(values["frist-s"], "frist-s") * MS_JE_S,
    takt: ganzzahl(values["takt-ms"], "takt-ms"),
  });
  const umgebung = { ueberschriften: ueberschriften() };
  const ergebnis = bewerte(faelle, laeufe, { wiederholungen, umgebung });
  const credits = laeufe.reduce((summe, lauf) => summe + lauf.credits, 0);
  stdout.write(bericht(ergebnis, { agent, wiederholungen, credits }));
  if (ergebnis.gruen) return EXIT_GRUEN;
  console.error(zweckBlock(ZWECK).join("\n"));
  return EXIT_ROT;
}

try {
  process.exitCode = await main();
} catch (fehler) {
  console.error(`Testgespräche abgebrochen, weil ${fehler.message}.`);
  process.exitCode = EXIT_FEHLER;
}
