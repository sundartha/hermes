import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { OLD_FINDING_LISTS } from "../freigabe-strenger.mjs";
import { repo } from "./github.mjs";

export const EMPTY_LIST_PREFIX = "Übergangsliste leer:";
const SUPPRESSIONS = "eslint-suppressions.json";
const TEXT_LIST_SUFFIX = ".txt";
const LINE_BREAK = "\n";
const WHOLE_FILE = "";
const COUNTS = "count";

const BASELINE_CHECK = (tool) => `ihr Abgleich für ${tool} in tools/basis-vergleich.mjs, danach meldet ${tool} jeden Befund direkt`;
const RULE_STOCK = (rule) => `die Option bestand der Regel ${rule} in eslint.config.js samt ihrem Einlesen in der Regel`;

const REMOVALS = new Map([
  [
    SUPPRESSIONS,
    [
      "eslint-suppressions.json, eslint-suppressions.empty.json und eslint-legacy-exceptions.json",
      "scripts/check-staged-suppressions.js mit seinem Aufruf in .githooks/pre-commit und dem CI-Schritt „Unterdrückungen steigen nicht“",
      "die Sonderlogik in tools/lint-neue-funktionen.mjs (applySuppressions: false, ganze Funktion bei Berührung)",
      "der Schalter --pass-on-unpruned-suppressions in package.json und tools/ziele/werkzeuge.mjs",
      "die Sorte altfunktion und die Basis unterdrueckungen in tools/ziele",
      "danach gilt schlicht eslint . streng",
    ],
  ],
  ["tools/basis/jscpd.json", [BASELINE_CHECK("jscpd")]],
  ["tools/basis/knip.json", [BASELINE_CHECK("knip")]],
  ["tools/basis/semgrep.json", [BASELINE_CHECK("semgrep")]],
  ["tools/basis/lessons.json", [BASELINE_CHECK("lessons")]],
  ["tools/basis/anweisungen.json", [BASELINE_CHECK("anweisungen")]],
  ["tools/basis/wurzel.json", [BASELINE_CHECK("wurzel")]],
  ["tools/basis/quelltext-als-text.json", [BASELINE_CHECK("quelltext-als-text"), RULE_STOCK("hermes/kein-quelltext-als-text")]],
  ["tools/basis/selbstpruefung.json", [BASELINE_CHECK("selbstpruefung"), RULE_STOCK("hermes-tests/keine-selbstpruefung")]],
  ["tools/basis/fester-importpfad.json", [BASELINE_CHECK("fester-importpfad"), RULE_STOCK("hermes-tests/fester-importpfad")]],
  ["tools/basis/test-importe.json", ["ihr Einlesen in tools/abhaengigkeiten.mjs"]],
  ["tools/basis/lieferkette-ausnahmen.json", ["ihr Einlesen in tools/lockfile-alter.mjs"]],
  ["tools/basis/katalog-ohne-test.txt", ["ihr Einlesen in tools/katalog-pruefen.mjs und tools/testwirkung/katalog.mjs"]],
]);

function textEntries(text) {
  return text.split(LINE_BREAK).filter((line) => line.trim() !== "").length;
}

function suppressedCount(content) {
  return Object.values(content).flatMap((rules) => Object.values(rules)).reduce((sum, { count }) => sum + count, 0);
}

function entryCount(path, key, text) {
  if (path.endsWith(TEXT_LIST_SUFFIX)) return textEntries(text);
  const content = JSON.parse(text);
  if (key === COUNTS) return suppressedCount(content);
  return (key === WHOLE_FILE ? content : content[key]).length;
}

export function transitionLists(root = ".") {
  return [...OLD_FINDING_LISTS]
    .filter(([path]) => existsSync(join(root, path)))
    .map(([path, key]) => ({ path, count: entryCount(path, key, readFileSync(join(root, path), "utf8")) }));
}

export function transitionSection(lists) {
  const lines = lists.map(({ path, count }) => `- \`${path}\`: ${count} ${path === SUPPRESSIONS ? "unterdrückte Verstöße" : "Einträge"}`);
  return [...lines, ""];
}

function emptyListBody(path) {
  const removals = REMOVALS.get(path) ?? [`die Datei ${path} und ihre Sonderbehandlung`];
  return [
    `Die Übergangsliste \`${path}\` hat keine Einträge mehr. Jetzt wird gelöscht:`,
    "",
    ...(path === SUPPRESSIONS ? removals : [`die Datei \`${path}\``, ...removals]).map((item) => `- ${item}`),
    "",
  ].join(LINE_BREAK);
}

export async function raiseEmptyLists(lists, openIssues, { limit }) {
  for (const { path } of lists.filter(({ count }) => count === 0)) {
    const title = `${EMPTY_LIST_PREFIX} ${path}`;
    if (openIssues.some((issue) => issue.title === title)) continue;
    if (openIssues.length >= limit) {
      console.error(`Obergrenze von ${limit} offenen Issues erreicht; „${title}“ fehlt.`);
      continue;
    }
    openIssues.push(await repo("/issues", { method: "POST", body: { title, body: emptyListBody(path) } }));
  }
}
