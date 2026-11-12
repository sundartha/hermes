import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { bausteinPruefung, karteAus, srcImporte } from "../../tools/bausteine.mjs";

const WURZEL = resolve(import.meta.dirname, "../..");
const NEU = join(WURZEL, "tools/neu.mjs");
const KARTE = "tools/bausteine.json";
const ROUTE = "src/routes/intern-anrufpause.js";
const FACHDATEI = "src/billing/probe-abruf.js";
const TEST = "test/rueckfrage/probe-test.test.js";
const ALLE = [ROUTE, FACHDATEI, TEST];
const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const KOPIERT = ["src", "tools", "eslint.config.js", "eslint-suppressions.json", ".dependency-cruiser.cjs", "package.json", "tsconfig.json"];
const ordner = [];
let wurzel;

after(() => {
  for (const eintrag of ordner) rmSync(eintrag, { recursive: true, force: true });
});

function lauf(befehl, argumente, cwd) {
  return spawnSync(befehl, argumente, { cwd, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" }, maxBuffer: 268_435_456 });
}

function neu(root, ...argumente) {
  return lauf(process.execPath, [NEU, "--wurzel", root, ...argumente], root);
}

function wegwerfWurzel() {
  const root = mkdtempSync(join(tmpdir(), "neu-"));
  ordner.push(root);
  for (const eintrag of KOPIERT) cpSync(join(WURZEL, eintrag), join(root, eintrag), { recursive: true });
  symlinkSync(join(WURZEL, "node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, "test"));
  rmSync(join(root, ROUTE));
  const karte = JSON.parse(readFileSync(join(root, KARTE), "utf8"));
  for (const baustein of karte.bausteine) {
    for (const schluessel of ["quellen", "eingaenge"]) {
      if (Array.isArray(baustein[schluessel])) baustein[schluessel] = baustein[schluessel].filter((pfad) => pfad !== ROUTE);
    }
  }
  writeFileSync(join(root, KARTE), JSON.stringify(karte, undefined, 2));
  return root;
}

function inhalt(root, datei) {
  return readFileSync(join(root, datei), "utf8");
}

before(() => {
  wurzel = wegwerfWurzel();
  for (const argumente of [["route", "betrieb", "intern-anrufpause"], ["fachdatei", "abrechnung", "probe-abruf"], ["test", "rueckfrage", "probe-test"]]) {
    const ergebnis = neu(wurzel, ...argumente);
    assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  }
});

test("die Art route erzeugt die Router-Form wie in der Fixture, mit webAuthMw und ohne Öffentlich-Eintrag", () => {
  const text = inhalt(wurzel, ROUTE);
  assert.equal(text, readFileSync(join(WURZEL, "test/fixtures/neu-intern-anrufpause.js.txt"), "utf8"));
  assert.match(text, /export function makeInternAnrufpauseRoutes\(\{ webAuthMw \}\) \{/);
  assert.match(text, /router\.post\(INTERN_ANRUFPAUSE_PATH, webAuthMw,/);
  assert.doesNotMatch(inhalt(wurzel, "src/route-policy.js"), /probe-abruf|api\/intern-anrufpause/);
});

test("die Art fachdatei liegt im Ordner des Bausteins und nutzt anfrage() und timer", () => {
  const text = inhalt(wurzel, FACHDATEI);
  assert.match(text, /^import \{ anfrage \} from "\.\.\/utils\/anfrage\.js";$/m);
  assert.match(text, /^import \{ MS_PER_SECOND \} from "\.\.\/utils\/timer\.js";$/m);
  assert.match(text, /^import \{ USAGE_EVENT_KIND \} from "\.\.\/begriffe\/abrechnung\.js";$/m);
  assert.match(text, /^export const PROBE_ABRUF_BEGRIFF = USAGE_EVENT_KIND;$/m);
  assert.match(text, /export async function holeProbeAbruf\(url/);
});

test("die Art test liegt unter test/<bereich>/ und importiert nur den Eingang des Bereichs", () => {
  const text = inhalt(wurzel, TEST);
  assert.match(text, /^import \* as eingang from "\.\.\/\.\.\/src\/consult\/question\.ts";$/m);
});

test("die Datei der Art route steht in der Bausteinkarte unter quellen und eingaenge von betrieb", () => {
  const betrieb = JSON.parse(inhalt(wurzel, KARTE)).bausteine.find(({ baustein }) => baustein === "betrieb");
  assert.ok(betrieb.quellen.includes(ROUTE));
  assert.ok(betrieb.eingaenge.includes(ROUTE));
});

test("die Datei in einem Ordner des Bausteins braucht keinen Kartenzusatz, Hinweise und Karte passen zusammen", () => {
  const karte = JSON.parse(inhalt(wurzel, KARTE));
  const abrechnung = karte.bausteine.find(({ baustein }) => baustein === "abrechnung");
  assert.ok(!abrechnung.quellen.includes(FACHDATEI));
  const hinweise = lauf(process.execPath, [join(wurzel, "tools/hinweise-erzeugen.mjs")], wurzel);
  assert.match(hinweise.stdout, /0 Dateien geändert/);
});

test("alle erzeugten Dateien bestehen ESLint mit der Konfiguration des Projekts", () => {
  const ergebnis = lauf(join(WURZEL, "node_modules/.bin/eslint"), ALLE, wurzel);
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stdout + ergebnis.stderr);
});

test("alle erzeugten Dateien bestehen die Abhängigkeitsregeln und die Bausteinkarte", () => {
  const ergebnis = lauf(join(WURZEL, "node_modules/.bin/depcruise"), [...ALLE, "--config", ".dependency-cruiser.cjs", "--output-type", "json"], wurzel);
  const graph = JSON.parse(ergebnis.stdout);
  assert.deepEqual(graph.summary.violations, []);
  const befunde = bausteinPruefung(karteAus(JSON.parse(inhalt(wurzel, KARTE))), {
    dateien: [ROUTE, FACHDATEI],
    importe: srcImporte(graph.modules),
  });
  assert.deepEqual([befunde.zuordnung, befunde.eingaenge, befunde.richtung], [[], [], []]);
});

test("der erzeugte Test läuft grün", () => {
  const ergebnis = lauf(process.execPath, [TEST], wurzel);
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stdout + ergebnis.stderr);
});

test("keine Bestandsliste und keine Unterdrückung nennt einen neuen Pfad", () => {
  const listen = [...readdirSync(join(wurzel, "tools/basis")).map((datei) => `tools/basis/${datei}`), "eslint-suppressions.json"];
  for (const liste of listen) {
    for (const pfad of [FACHDATEI, TEST]) assert.ok(!inhalt(wurzel, liste).includes(pfad), `${liste} nennt ${pfad}`);
  }
});

test("unbekannte Art, unbekannter Baustein oder Bereich, ungültiger Name und vorhandene Datei brechen ab, ohne zu schreiben", () => {
  const root = wegwerfWurzel();
  const vorher = inhalt(root, KARTE);
  const faelle = [
    [["modul", "abrechnung", "x-y"], /Aufruf: npm run neu/],
    [["fachdatei", "gibtsnicht", "x-y"], /Unbekannter Baustein gibtsnicht/],
    [["test", "gibtsnicht", "x-y"], /Unbekannter Bereich gibtsnicht/],
    [["fachdatei", "abrechnung", "GrossName"], /muss klein geschrieben/],
    [["route", "betrieb", "intern-status"], /gibt es schon/],
    [["fachdatei", "betrieb", "x-y"], /keinen Ordner/],
    [["test", "werkzeuge", "x-y"], /keinen Eingang/],
  ];
  for (const [argumente, meldung] of faelle) {
    const ergebnis = neu(root, ...argumente);
    assert.equal(ergebnis.status, EXIT_FEHLER, argumente.join(" "));
    assert.match(ergebnis.stderr, meldung);
  }
  assert.equal(inhalt(root, KARTE), vorher);
  assert.equal(readdirSync(join(root, "test")).length, 0);
  assert.equal(readdirSync(join(root, "src/billing")).includes("x-y.js"), false);
});
