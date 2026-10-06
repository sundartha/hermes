#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const TURNS_WARNSCHWELLE = 150;
const MIO = 1e6;
const TAUSEND = 1e3;
const STANDARD_ANZAHL_LAEUFE = 12;

const BREITE_ID = 17;
const BREITE_DATUM = 18;
const BREITE_SUMME = 9;
const BREITE_TURNS = 8;
const BREITE_AGENTEN = 9;
const BREITE_TRENNER = 61;
const BREITE_TRENNER_LAUF = 72;
const BREITE_SUMMENLABEL = 35;
const BEISPIELE_IM_FEHLERTEXT = 3;

const DATUM_LAENGE = 16;

const LEER_SUMME = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, turns: 0 };

function projektWurzel() {
  const kodiert = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", kodiert);
}

function unterverzeichnisse(pfad) {
  if (!existsSync(pfad)) return [];
  return readdirSync(pfad, { withFileTypes: true })
    .filter((eintrag) => eintrag.isDirectory())
    .map((eintrag) => join(pfad, eintrag.name));
}

function laufVerzeichnisse(wurzel) {
  const gefunden = [];
  for (const sitzung of unterverzeichnisse(wurzel)) {
    gefunden.push(...unterverzeichnisse(join(sitzung, "subagents", "workflows")));
  }
  return gefunden;
}

function leseUsage(zeile) {
  if (!zeile) return null;
  let satz;
  try {
    satz = JSON.parse(zeile);
  } catch {
    return null;
  }
  const usage = satz?.message?.usage ?? satz?.usage;
  return usage && typeof usage === "object" ? usage : null;
}

function zaehleDatei(datei) {
  const summe = { ...LEER_SUMME };
  let inhalt;
  try {
    inhalt = readFileSync(datei, "utf8");
  } catch {
    return summe;
  }
  for (const zeile of inhalt.split("\n")) {
    const usage = leseUsage(zeile);
    if (!usage) continue;
    summe.turns += 1;
    summe.cacheRead += usage.cache_read_input_tokens ?? 0;
    summe.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    summe.input += usage.input_tokens ?? 0;
    summe.output += usage.output_tokens ?? 0;
  }
  return summe;
}

const gesamt = (satz) => satz.cacheRead + satz.cacheWrite + satz.input + satz.output;

function addiere(links, rechts) {
  return {
    cacheRead: links.cacheRead + rechts.cacheRead,
    cacheWrite: links.cacheWrite + rechts.cacheWrite,
    input: links.input + rechts.input,
    output: links.output + rechts.output,
    turns: links.turns + rechts.turns,
  };
}

function leseAgenten(laufPfad) {
  return readdirSync(laufPfad)
    .filter((name) => name.startsWith("agent-") && name.endsWith(".jsonl"))
    .map((name) => {
      const datei = join(laufPfad, name);
      const kennung = name.slice("agent-".length, -".jsonl".length);
      return { kennung, zeit: statSync(datei).mtimeMs, ...zaehleDatei(datei) };
    });
}

function leseLauf(laufPfad) {
  const agenten = leseAgenten(laufPfad);
  const summe = agenten.reduce(addiere, { ...LEER_SUMME });
  const zeit = agenten.length ? Math.max(...agenten.map((agent) => agent.zeit)) : 0;
  return { id: basename(laufPfad), agenten, ...summe, zeit };
}

const mio = (zahl) => `${(zahl / MIO).toFixed(1)}M`;
const datum = (millis) => new Date(millis).toISOString().slice(0, DATUM_LAENGE).replace("T", " ");

function zeigeLauf(lauf) {
  const output = `${(lauf.output / TAUSEND).toFixed(0)}k`;
  console.log(`\nLauf ${lauf.id}  -  ${datum(lauf.zeit)}  -  ${lauf.agenten.length} Agenten`);
  console.log(`GESAMT ${mio(gesamt(lauf))}   davon Cache-Reads ${mio(lauf.cacheRead)}   Output ${output}   Turns ${lauf.turns}`);
  console.log("-".repeat(BREITE_TRENNER_LAUF));
  for (const agent of [...lauf.agenten].sort((links, rechts) => gesamt(rechts) - gesamt(links))) {
    const warnung = agent.turns > TURNS_WARNSCHWELLE ? `  <-- ${agent.turns} Turns, teurer Bereich` : "";
    const kennung = agent.kennung.slice(0, BREITE_ID).padEnd(BREITE_ID);
    console.log(`  ${kennung} ${mio(gesamt(agent)).padStart(BREITE_SUMME)}  ${String(agent.turns).padStart(BREITE_TURNS)} Turns${warnung}`);
  }
}

function zeigeTabelle(laeufe, titel) {
  console.log(`\n${titel}\n`);
  const kopf = "Lauf".padEnd(BREITE_ID) + "Datum".padEnd(BREITE_DATUM) + "GESAMT".padStart(BREITE_SUMME) + "Turns".padStart(BREITE_TURNS) + "Agenten".padStart(BREITE_AGENTEN);
  console.log(kopf);
  console.log("-".repeat(BREITE_TRENNER));
  for (const lauf of laeufe) {
    const zeile =
      lauf.id.slice(0, BREITE_ID).padEnd(BREITE_ID) +
      datum(lauf.zeit).padEnd(BREITE_DATUM) +
      mio(gesamt(lauf)).padStart(BREITE_SUMME) +
      String(lauf.turns).padStart(BREITE_TURNS) +
      String(lauf.agenten.length).padStart(BREITE_AGENTEN);
    console.log(zeile);
  }
  const summe = laeufe.reduce((zwischen, lauf) => zwischen + gesamt(lauf), 0);
  const turns = laeufe.reduce((zwischen, lauf) => zwischen + lauf.turns, 0);
  console.log("-".repeat(BREITE_TRENNER));
  console.log(`SUMME (${laeufe.length} Laeufe)`.padEnd(BREITE_SUMMENLABEL) + mio(summe).padStart(BREITE_SUMME) + String(turns).padStart(BREITE_TURNS));
}

const wurzel = projektWurzel();
const alleLaeufe = laufVerzeichnisse(wurzel)
  .map(leseLauf)
  .filter((lauf) => lauf.agenten.length > 0);

if (alleLaeufe.length === 0) {
  console.error(`FEHLER: unter "${wurzel}" liegt kein einziger Workflow-Lauf.`);
  console.error("Entweder ist das Arbeitsverzeichnis falsch, oder der Ablageort hat sich geaendert.");
  console.error("Das ist KEINE Aussage ueber die Kosten - es wurde nichts gemessen.");
  process.exit(1);
}

alleLaeufe.sort((links, rechts) => rechts.zeit - links.zeit);
const argument = process.argv[2];

if (argument === "--alle") {
  const sortiert = [...alleLaeufe].sort((links, rechts) => gesamt(rechts) - gesamt(links));
  zeigeTabelle(sortiert, `Alle ${alleLaeufe.length} Laeufe dieses Projekts, teuerste zuerst`);
} else if (argument) {
  const treffer = alleLaeufe.filter((lauf) => lauf.id.includes(argument));
  if (treffer.length === 0) {
    const beispiele = alleLaeufe.slice(0, BEISPIELE_IM_FEHLERTEXT).map((lauf) => lauf.id).join(", ");
    console.error(`FEHLER: kein Lauf passt auf "${argument}". Bekannt sind z.B.: ${beispiele}`);
    process.exit(1);
  }
  treffer.forEach(zeigeLauf);
} else {
  const anzahl = Math.min(STANDARD_ANZAHL_LAEUFE, alleLaeufe.length);
  zeigeTabelle(alleLaeufe.slice(0, anzahl), `Die ${anzahl} juengsten Laeufe (von ${alleLaeufe.length})`);
  console.log("\nEinzelner Lauf: node scripts/workflow-kosten.mjs <lauf-id>   |   Gesamtbilanz: --alle");
}
