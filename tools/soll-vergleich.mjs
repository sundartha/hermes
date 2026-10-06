import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { istStand } from "./soll-vergleich/abruf.mjs";
import {
  codeownersVergleich,
  environmentsVergleich,
  mitarbeiterVergleich,
  repoVergleich,
  rulesetVergleich,
  weitereRulesetsVergleich,
} from "./soll-vergleich/vergleich.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STANDARD_SOLL = ".github/soll/einstellungen.json";
const PFLICHTFELDER = [
  "repo",
  "ruleset",
  "repo_einstellungen",
  "mitarbeiter",
  "codeowners",
  "environments",
  "weitere_rulesets",
];
const EXIT_GLEICH = 0;
const EXIT_ABWEICHUNG = 1;
const EXIT_FEHLER = 2;
const TABELLENTRENNER = /\|/g;
const ZEILENUMBRUCH = /\n/g;

function dateiText(datei) {
  try {
    return readFileSync(datei, "utf8");
  } catch {
    throw new Error(`die Soll-Datei ${datei} fehlt oder nicht lesbar ist`);
  }
}

function sollLesen(datei) {
  const inhalt = dateiText(datei);
  let soll;
  try {
    soll = JSON.parse(inhalt);
  } catch {
    throw new Error(`die Soll-Datei ${datei} kein gültiges JSON enthält`);
  }
  const fehlend = PFLICHTFELDER.filter((name) => soll?.[name] === undefined);
  if (soll?.ruleset?.id === undefined) fehlend.push("ruleset.id");
  if (fehlend.length > 0) {
    throw new Error(`in der Soll-Datei ${datei} diese Felder fehlen: ${fehlend.join(", ")}`);
  }
  return soll;
}

function vergleiche(soll, ist) {
  const ruleset = rulesetVergleich(soll.ruleset, ist.ruleset);
  const weitere = weitereRulesetsVergleich(soll.ruleset.id, soll.weitere_rulesets, ist.rulesets);
  return {
    abweichungen: [
      ...ruleset.abweichungen,
      ...weitere.abweichungen,
      ...repoVergleich(soll.repo_einstellungen, ist.repo),
      ...mitarbeiterVergleich(soll.mitarbeiter, ist.mitarbeiter),
      ...codeownersVergleich(soll.codeowners, ist.codeowners),
      ...environmentsVergleich(soll.environments, ist.environments),
    ],
    nichtPruefbar: [...ruleset.nichtPruefbar, ...weitere.nichtPruefbar],
  };
}

function zelle(wert) {
  return String(wert).replace(TABELLENTRENNER, "\\|").replace(ZEILENUMBRUCH, " ");
}

function tabelle(abweichungen) {
  const zeilen = abweichungen.map(
    ({ bereich, feld, soll, ist }) => `| ${[bereich, feld, soll, ist].map(zelle).join(" | ")} |`,
  );
  return [
    `${abweichungen.length} Abweichung(en):`,
    "",
    "| Bereich | Feld | Soll | Ist |",
    "| --- | --- | --- | --- |",
    ...zeilen,
  ];
}

function bericht({ abweichungen, nichtPruefbar }, repo) {
  const ergebnis = abweichungen.length === 0 ? ["Keine Abweichung."] : tabelle(abweichungen);
  const hinweise =
    nichtPruefbar.length === 0
      ? []
      : ["", "Nicht prüfbar:", "", ...nichtPruefbar.map((hinweis) => `- ${hinweis}`)];
  return [`## Soll-Vergleich`, "", `Repo: ${repo}`, "", ...ergebnis, ...hinweise, ""].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { soll: { type: "string" } } });
  const soll = sollLesen(values.soll ?? join(REPO_ROOT, STANDARD_SOLL));
  const ergebnis = vergleiche(soll, await istStand(soll));
  stdout.write(bericht(ergebnis, soll.repo));
  return ergebnis.abweichungen.length === 0 ? EXIT_GLEICH : EXIT_ABWEICHUNG;
}

try {
  process.exitCode = await main();
} catch (fehler) {
  console.error(`Soll-Vergleich abgebrochen, weil ${fehler.message}.`);
  process.exitCode = EXIT_FEHLER;
}
