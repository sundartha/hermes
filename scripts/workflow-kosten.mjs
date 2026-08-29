#!/usr/bin/env node
// Misst, was ein Workflow-Lauf WIRKLICH gekostet hat.
//
// WARUM ES DIESES SKRIPT GIBT: die Kennzahl "subagent_tokens", die das Workflow-Werkzeug nach
// jedem Lauf meldet, laesst die Cache-Reads weg. Die sind aber ~99,7 % des Verbrauchs. Gemessen
// am 29.08.2026: das Werkzeug meldete 3,0 Mio fuer einen Lauf, der 860,7 Mio gekostet hat, und
// eine Uebergabe schrieb "rund 15,5 Mio" fuer eine Kette, die 3.060 Mio gekostet hat - Faktor 197.
// Weil niemand die echte Zahl las, wuchsen die Beweispflichten in den per-run-Skripten monoton
// (6 -> 9 -> 6 -> 7 -> 10 -> 12 "woertlich"-Forderungen ueber E1..E5), ohne dass etwas dagegen
// drueckte. Dieses Skript ist die fehlende Gegenkraft: es liest die Agenten-Transkripte, in denen
// die Wahrheit ohnehin steht.
//
// KOSTENFORMEL: Verbrauch ~ Kontextgroesse x Turns. Das ist quadratisch, nicht linear - jede
// Ausgabe, die einmal im Kontext liegt, wird bei JEDEM weiteren Turn erneut gelesen und bezahlt.
// Zwei Stellschrauben folgen daraus: (1) nichts Grosses in den Kontext holen (keine woertlichen
// Testlauf-Ausgaben; Exit-Code und die "# pass"/"# fail"-Zeilen genuegen als Beleg), (2) Agenten
// kurz halten (viele kleine mit frischem Kontext statt eines langen).
//
// Aufruf:
//   node scripts/workflow-kosten.mjs                 die juengsten Laeufe dieses Projekts
//   node scripts/workflow-kosten.mjs <lauf-id>       ein Lauf, je Agent aufgeschluesselt
//   node scripts/workflow-kosten.mjs --alle          Gesamtbilanz, teuerste zuerst
//
// Nur lesend. Keine Secrets, keine Gespraechsinhalte - ausschliesslich Zaehlwerte.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// Ab hier gilt ein Agent als teuer: bei ~467k Kontext kostet jeder weitere Turn spuerbar.
// Der teuerste gemessene Agent lief 955 Turns und verbrauchte 447 Mio.
const TURNS_WARNSCHWELLE = 150;
const MIO = 1e6;
const TAUSEND = 1e3;
const STANDARD_ANZAHL_LAEUFE = 12;

// Spaltenbreiten der Ausgabe.
const BREITE_ID = 17;
const BREITE_DATUM = 18;
const BREITE_SUMME = 9;
const BREITE_TURNS = 8;
const BREITE_AGENTEN = 9;
const BREITE_TRENNER = 61;
const BREITE_TRENNER_LAUF = 72;
const BREITE_SUMMENLABEL = 35;
const BEISPIELE_IM_FEHLERTEXT = 3;

// "2026-08-29T18:02:11.000Z" -> "2026-08-29 18:02"
const DATUM_LAENGE = 16;

const LEER_SUMME = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, turns: 0 };

function projektWurzel() {
  // Claude Code legt Transkripte unter ~/.claude/projects/<pfad-mit-bindestrichen>/ ab: JEDES
  // Zeichen ausserhalb [A-Za-z0-9] wird zum Bindestrich - Schraegstriche wie Leerzeichen.
  // (Der Repo-Pfad enthaelt beides, "Mein Unternehmen".)
  const kodiert = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", kodiert);
}

function unterverzeichnisse(pfad) {
  if (!existsSync(pfad)) return [];
  return readdirSync(pfad, { withFileTypes: true })
    .filter((eintrag) => eintrag.isDirectory())
    .map((eintrag) => join(pfad, eintrag.name));
}

// Alle Lauf-Verzeichnisse: <projekt>/<sitzung>/subagents/workflows/<lauf>/
function laufVerzeichnisse(wurzel) {
  const gefunden = [];
  for (const sitzung of unterverzeichnisse(wurzel)) {
    gefunden.push(...unterverzeichnisse(join(sitzung, "subagents", "workflows")));
  }
  return gefunden;
}

// Eine Transkript-Zeile ist JSON; traegt sie einen usage-Block, war sie ein bezahlter Turn.
// Der Block sitzt je nach Satzart unter "message.usage" oder direkt unter "usage".
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

// POSITIV-KONTROLLE: "nichts gefunden" darf nicht aussehen wie "alles guenstig". Ohne diesen
// Riegel meldet ein falscher Pfad still eine leere, beruhigende Bilanz. Beim ersten Lauf hat
// genau das zugeschlagen (Leerzeichen im Repo-Pfad falsch kodiert).
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
