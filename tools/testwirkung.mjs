import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import { cwd, env } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Linter } from "eslint";

const TESTDATEI = /^test\/.+\.test\.[cm]?js$/;
const TESTFUNKTIONEN = new Set(["test", "it"]);
const UNTERTEST = "test";
const MIN_UNTERTEST_ARGUMENTE = 2;
const FUNKTIONSARTEN = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
const COMMONJS = ".cjs";
const REGEL = "testwirkung/testaufrufe";
const REGEX_ZEICHEN = /[.*+?^${}()|[\]\\]/g;
const WIEDERHOLUNGEN = 5;
const TESTPARALLEL = 4;
const MS_JE_MINUTE = 60_000;
const ZEITGRENZE_MINUTEN = 10;
const MAX_AUSGABE = 268_435_456;
const OHNE_PRUEFUNG = fileURLToPath(new URL("testwirkung/ohne-pruefung.mjs", import.meta.url));
const MELDER = fileURLToPath(new URL("testwirkung/melder.mjs", import.meta.url));
const TESTKONTEXT = "NODE_TEST_CONTEXT";
const LAUF_OHNE_PRUEFUNG = "A";
const WIEDERHOLUNGSLAUF = "B";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const AUFRUF = "Aufruf: node tools/testwirkung.mjs --basis <commit>";

function git(args) {
  const ergebnis = spawnSync("git", args, { encoding: "utf8", maxBuffer: MAX_AUSGABE });
  if (ergebnis.status !== 0) throw new Error(`git ${args.join(" ")}: ${ergebnis.stderr.trim()}`);
  return ergebnis.stdout;
}

function istTestaufruf({ callee, arguments: argumente }) {
  if (TESTFUNKTIONEN.has(callee.name)) return true;
  if (callee.type !== "MemberExpression") return false;
  if (TESTFUNKTIONEN.has(callee.object.name)) return true;
  const letztes = argumente.at(-1);
  return callee.property.name === UNTERTEST && argumente.length >= MIN_UNTERTEST_ARGUMENTE && FUNKTIONSARTEN.has(letztes.type);
}

function festerName(argument) {
  if (argument?.type === "Literal") return typeof argument.value === "string" ? argument.value : undefined;
  if (argument?.type !== "TemplateLiteral" || argument.expressions.length > 0) return undefined;
  const [{ value }] = argument.quasis;
  return value.cooked;
}

function erfasse(quelle, knoten) {
  const [erstes] = knoten.arguments;
  const vorfahren = quelle
    .getAncestors(knoten)
    .filter((vorfahr) => vorfahr.type === "CallExpression" && istTestaufruf(vorfahr));
  return {
    name: festerName(erstes),
    text: erstes === undefined ? "" : quelle.getText(erstes),
    vorfahren: vorfahren.map((vorfahr) => festerName(vorfahr.arguments[0])).filter((name) => name !== undefined),
  };
}

function testaufrufe(datei, quelltext) {
  const gefunden = [];
  const testaufrufeSammeln = {
    create: (kontext) => ({
      CallExpression: (knoten) => {
        if (istTestaufruf(knoten)) gefunden.push(erfasse(kontext.sourceCode, knoten));
      },
    }),
  };
  const konfiguration = {
    languageOptions: { ecmaVersion: "latest", sourceType: extname(datei) === COMMONJS ? "commonjs" : "module" },
    plugins: { testwirkung: { rules: { testaufrufe: testaufrufeSammeln } } },
    rules: { [REGEL]: "error" },
  };
  const fatal = new Linter().verify(quelltext, konfiguration, { filename: datei }).find((meldung) => meldung.fatal);
  if (fatal !== undefined) throw new Error(`${datei} lässt sich nicht lesen: ${fatal.message}`);
  return gefunden;
}

function basisText(basis, datei) {
  const ergebnis = spawnSync("git", ["show", `${basis}:${datei}`], { encoding: "utf8", maxBuffer: MAX_AUSGABE });
  return ergebnis.status === 0 ? ergebnis.stdout : "";
}

function geaenderteTestdateien(basis) {
  const liste = git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=d", basis, "--", "test/"]);
  return liste.split("\0").filter((datei) => TESTDATEI.test(datei));
}

function neuIn(basis, datei) {
  const vorher = testaufrufe(datei, basisText(basis, datei));
  const nachher = testaufrufe(datei, readFileSync(datei, "utf8"));
  const alteNamen = new Set(vorher.map(({ name }) => name));
  const alteTexte = new Set(vorher.map(({ text }) => text));
  const benannt = new Map();
  const unbenannt = new Set();
  for (const { name, text, vorfahren } of nachher) {
    if (name === undefined && !alteTexte.has(text)) unbenannt.add(`${datei} › ${text}`);
    if (name !== undefined && !alteNamen.has(name)) benannt.set(name, { datei, name, vorfahren });
  }
  return { benannt: [...benannt.values()], unbenannt: [...unbenannt] };
}

function neueTests(basis) {
  const jeDatei = geaenderteTestdateien(basis).map((datei) => neuIn(basis, datei));
  return {
    tests: jeDatei.flatMap(({ benannt }) => benannt),
    ohneNamen: jeDatei.flatMap(({ unbenannt }) => unbenannt),
  };
}

function schluessel({ datei, name }) {
  return `${datei} › ${name}`;
}

function namensmuster(tests) {
  const namen = new Set(tests.flatMap(({ name, vorfahren }) => [name, ...vorfahren]));
  return [...namen].map((name) => `--test-name-pattern=^${name.replace(REGEX_ZEICHEN, "\\$&")}$`);
}

function eintrag(zeile) {
  const { name, datei, bestanden } = JSON.parse(zeile);
  const pfad = datei?.startsWith("file:") ? fileURLToPath(datei) : (datei ?? "");
  return { datei: relative(cwd(), pfad), name, bestanden };
}

function eigenstaendig() {
  const { [TESTKONTEXT]: _geerbt, ...umgebung } = env;
  return umgebung;
}

function lauf(tests, vorspann) {
  const dateien = [...new Set(tests.map(({ datei }) => datei))];
  const argumente = [...vorspann, "--test", `--test-concurrency=${TESTPARALLEL}`, `--test-reporter=${MELDER}`];
  const ergebnis = spawnSync(process.execPath, [...argumente, ...namensmuster(tests), ...dateien], {
    encoding: "utf8",
    env: eigenstaendig(),
    timeout: ZEITGRENZE_MINUTEN * MS_JE_MINUTE,
    maxBuffer: MAX_AUSGABE,
  });
  if (ergebnis.error !== undefined || ergebnis.signal !== null) {
    throw new Error(`Testlauf abgebrochen: ${ergebnis.error?.message ?? ergebnis.signal}`);
  }
  const jeTest = new Map(tests.map((test) => [schluessel(test), []]));
  for (const zeile of ergebnis.stdout.split("\n").filter(Boolean)) {
    const gelaufen = eintrag(zeile);
    jeTest.get(schluessel(gelaufen))?.push(gelaufen.bestanden);
  }
  return jeTest;
}

function laufname(index) {
  return index === 0 ? LAUF_OHNE_PRUEFUNG : `${WIEDERHOLUNGSLAUF}${index}`;
}

function befund(test, { ohnePruefung, wiederholungen }) {
  const kennung = schluessel(test);
  const laeufe = [ohnePruefung, ...wiederholungen].map((ergebnisse) => ergebnisse.get(kennung));
  const [ersterLauf, ...weitere] = laeufe;
  const rot = weitere.filter((ergebnisse) => ergebnisse.includes(false)).length;
  const gruen = weitere.filter((ergebnisse) => ergebnisse.length > 0 && !ergebnisse.includes(false)).length;
  return {
    kennung,
    fehlt: laeufe.flatMap((ergebnisse, index) => (ergebnisse.length === 0 ? [laufname(index)] : [])),
    leer: ersterLauf.includes(true),
    wackelt: rot > 0 && gruen > 0,
    rot,
  };
}

function befunde(tests) {
  if (tests.length === 0) return [];
  const ohnePruefung = lauf(tests, ["--import", OHNE_PRUEFUNG]);
  const wiederholungen = Array.from({ length: WIEDERHOLUNGEN }, () => lauf(tests, []));
  return tests.map((test) => befund(test, { ohnePruefung, wiederholungen }));
}

function verstoesse(ohneNamen, ergebnisse) {
  const mit = (merkmal) => ergebnisse.filter(merkmal);
  return [
    ...ohneNamen.map((aufruf) => `Test ohne festen Namen: ${aufruf}`),
    ...mit(({ leer }) => leer).map(({ kennung }) => `Test bleibt grün, obwohl jede Prüfung scheitert: ${kennung}`),
    ...mit(({ wackelt }) => wackelt).map(({ kennung, rot }) => `Test wackelt: ${kennung} (${rot} von ${WIEDERHOLUNGEN} Läufen rot)`),
    ...mit(({ fehlt }) => fehlt.length > 0).map(({ kennung, fehlt }) => `Test nicht gelaufen: ${kennung} (Lauf ${fehlt.join(", ")})`),
  ];
}

function zusammenfassung(urteil, ergebnisse) {
  const zahl = (merkmal) => ergebnisse.filter(merkmal).length;
  const leer = zahl(({ leer: ohneWirkung }) => ohneWirkung);
  const wackeln = zahl(({ wackelt }) => wackelt);
  const fehlen = zahl(({ fehlt }) => fehlt.length > 0);
  return `${urteil}: ${ergebnisse.length} neue Tests, ${leer} ohne wirksame Prüfung, ${wackeln} wackeln in ${WIEDERHOLUNGEN} Läufen, ${fehlen} nicht gelaufen.`;
}

function main() {
  const { values } = parseArgs({ options: { basis: { type: "string" } } });
  if (values.basis === undefined) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  const { tests, ohneNamen } = neueTests(values.basis);
  const ergebnisse = befunde(tests);
  const gefunden = verstoesse(ohneNamen, ergebnisse);
  for (const verstoss of gefunden) console.log(`Verstoß: ${verstoss}`);
  const urteil = gefunden.length === 0 ? "grün" : "rot";
  console.log(zusammenfassung(urteil, ergebnisse));
  return urteil === "grün" ? EXIT_GRUEN : EXIT_ROT;
}

try {
  process.exitCode = main();
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
}
