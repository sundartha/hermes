import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { bausteinBefunde } from "./abhaengigkeiten/bausteine.mjs";
import { aufDerBasis, bestaendeNurKuerzer, imArbeitsbaum } from "./abhaengigkeiten/bestaende.mjs";
import { run } from "./abhaengigkeiten/prozess.mjs";
import { sammeldateiBefunde, sammeldateiZusammenfassung } from "./abhaengigkeiten/sammeldatei-exporte.mjs";
import { testordnung } from "./abhaengigkeiten/testordnung.mjs";
import { zweckBlock } from "./auftrag/zweck.mjs";
import { ALTVERSTOESSE, altverstoesseDerNeuen, altverstossSchluessel as violationKey } from "./auslagerung-eintraege.mjs";
import { aufgeteilt, rueckfuehrung, unveraendert } from "./bestand-rueckfuehrung.mjs";
import { reineQuellauslagerung } from "./mutationspruefung/quellauslagerung.mjs";
import { TYPESCRIPT } from "./umbenennung.mjs";

const CONFIG_PATH = ".dependency-cruiser.cjs";
const SOURCE_DIRECTORY = "src";
const TEST_DIRECTORY = "test";
const DEPCRUISE_BIN = fileURLToPath(
  new URL("../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", import.meta.url),
);
const TEST_IMPORT_RULES = new Set(["tests-nur-ueber-eingaenge", "werkzeug-tests-ohne-src"]);
const FROZEN_LISTS = [
  {
    path: ".dependency-cruiser-known-violations.json",
    label: "Altverstöße",
    covers: (violation) => !TEST_IMPORT_RULES.has(violation.rule.name),
    zweck: "basis/abhaengigkeitsregeln",
  },
  {
    path: "tools/basis/test-importe.json",
    label: "Testimporte an internen Modulen",
    covers: (violation) => TEST_IMPORT_RULES.has(violation.rule.name),
    zweck: "basis/test-importe",
  },
];
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const USAGE = "Aufruf: node tools/abhaengigkeiten.mjs --basis <commit>";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function ruleComments() {
  const { forbidden } = createRequire(import.meta.url)(resolve(CONFIG_PATH));
  return new Map(forbidden.map(({ name, comment }) => [name, comment]));
}

function checkedDirectories() {
  return existsSync(TEST_DIRECTORY) ? [SOURCE_DIRECTORY, TEST_DIRECTORY] : [SOURCE_DIRECTORY];
}

function currentGraph() {
  const args = [DEPCRUISE_BIN, ...checkedDirectories(), "--config", CONFIG_PATH];
  const result = run(process.execPath, [...args, "--output-type", "json"]);
  if (result.status !== EXIT_OK) {
    throw new Error(`dependency-cruiser ist gescheitert:\n${result.stderr}`);
  }
  const { modules, summary } = JSON.parse(result.stdout);
  return { modules, violations: summary.violations };
}

function checkBasis(basis) {
  if (run("git", ["cat-file", "-e", `${basis}^{commit}`]).status !== EXIT_OK) {
    throw new Error(`Die Basis ${basis} ist kein Commit in diesem Checkout.`);
  }
}

function listState(list, { violations, basis }) {
  return {
    ...list,
    violations: violations.filter(list.covers),
    known: imArbeitsbaum(list.path),
    basisKnown: aufDerBasis(basis, list.path),
  };
}

function missingFrom(violations, reference) {
  const referenceKeys = new Set(reference.map(violationKey));
  return violations.filter((violation) => !referenceKeys.has(violationKey(violation)));
}

async function oldPathOf(basis, states, grownStocks) {
  const grown = states.flatMap(({ known, basisKnown }) => missingFrom(known, basisKnown ?? known));
  const renamed = grown.some(({ from, to }) => TYPESCRIPT.test(from) || TYPESCRIPT.test(to));
  if (!renamed && grownStocks.length === 0) return unveraendert;
  return rueckfuehrung(basis);
}

function describe(violation, comments) {
  const { rule, from, to } = violation;
  return `${from} → ${to} verstößt gegen „${rule.name}“. ${comments.get(rule.name)}`;
}

function findingsFor({ path, violations, known, basisKnown }, { comments, oldPath, ausgelagert }) {
  const newViolations = missingFrom(violations, known).map(
    (violation) => `Neuer Verstoß: ${describe(violation, comments)}`,
  );
  const asBefore = ({ rule, from, to }) =>
    violationKey({ rule, from: oldPath(from), to: oldPath(to) });
  const allowed = [...(basisKnown ?? known), ...ausgelagert].map(violationKey);
  const grownEntries = aufgeteilt(known, allowed, asBefore).darueber.map(
    (violation) =>
      `${path} darf nur kürzer werden, neu eingefroren ist: ${describe(violation, comments)}`,
  );
  return [...newViolations, ...grownEntries];
}

function summary({ path, label, violations, known, basisKnown }) {
  const fixed = missingFrom(known, violations).length;
  const gewachsen = known.length - (basisKnown?.length ?? known.length);
  const basisNote =
    basisKnown === undefined
      ? "die Basis hat noch keine eingefrorene Liste"
      : gewachsen > 0
        ? `die Liste ist gegenüber der Basis um ${gewachsen} Altverstoß einer reinen Auslagerung gewachsen`
        : "die Liste ist gegenüber der Basis nicht gewachsen";
  return `${violations.length} ${label}, alle eingefroren in ${path}; ${fixed} eingefrorene Einträge sind behoben und können gestrichen werden; ${basisNote}`;
}

export const BEFUNDQUELLEN = [
  ...FROZEN_LISTS.map(({ zweck }, index) => ({
    zweck,
    befunde: ({ states, comments, oldPath, ausgelagert }) =>
      findingsFor(states[index], { comments, oldPath, ausgelagert: ausgelagert[index] }),
  })),
  {
    zweck: "basis/testregel-bestaende",
    befunde: ({ basis, oldPath }) => bestaendeNurKuerzer(basis, oldPath),
  },
  { zweck: "basis/testordnung", befunde: ({ order }) => order.befunde },
  { zweck: "basis/bausteine-zuordnung", befunde: ({ bausteine }) => bausteine.zuordnung },
  { zweck: "basis/bausteine-eingaenge", befunde: ({ bausteine }) => bausteine.eingaenge },
  { zweck: "basis/bausteine-richtung", befunde: ({ bausteine }) => bausteine.richtung },
  { zweck: "basis/sammeldatei-exporte", befunde: ({ basis }) => sammeldateiBefunde(basis) },
];

function reportFindings(sources) {
  const findings = sources.flatMap(({ befunde }) => befunde);
  for (const finding of findings) console.error(finding);
  for (const { zweck, befunde } of sources) {
    if (befunde.length > 0) console.error(zweckBlock(zweck).join("\n"));
  }
  return findings.length;
}

async function main() {
  const basis = optionValue("--basis");
  if (basis === undefined) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  checkBasis(basis);
  const { modules, violations } = currentGraph();
  const states = FROZEN_LISTS.map((list) => listState(list, { violations, basis }));
  const comments = ruleComments();
  const oldPath = await oldPathOf(basis, states, bestaendeNurKuerzer(basis));
  const order = await testordnung(basis);
  const bausteine = bausteinBefunde(modules);
  const auslagerung = await reineQuellauslagerung({ von: basis }, process.cwd());
  const ausgelagert = states.map(({ path, basisKnown }) => (path === ALTVERSTOESSE ? altverstoesseDerNeuen(auslagerung, basisKnown ?? []) : []));
  const context = { basis, states, comments, oldPath, order, bausteine, ausgelagert };
  const sources = BEFUNDQUELLEN.map(({ zweck, befunde }) => ({ zweck, befunde: befunde(context) }));
  if (reportFindings(sources) > 0) return EXIT_FINDING;
  for (const state of states) console.log(summary(state));
  console.log(order.zusammenfassung);
  if (bausteine.zusammenfassung !== undefined) console.log(bausteine.zusammenfassung);
  const sammeldateien = sammeldateiZusammenfassung();
  if (sammeldateien !== undefined) console.log(sammeldateien);
  return EXIT_OK;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = EXIT_USAGE;
  }
}
