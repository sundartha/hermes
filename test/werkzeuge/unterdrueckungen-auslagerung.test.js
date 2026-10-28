import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TOR, UNTERDRUECKUNGEN, istGruen, istRot } from "./unterdrueckungen-probe.js";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const HILFE = "src/werte.js";
const NEU = "src/rechnen.js";
const ZWEITE = "src/bleiben.js";
const REGELN = '{ "id-length": "error", "no-magic-numbers": "error" }';
const KONFIG = `export default [{ files: ["**/*.js"], rules: ${REGELN} }];\n`;
const KURZ = "function kurz(x) {\n  return x * 60;\n}";
const RECHNE = "export function rechne(wert) {\n  return kurz(wert);\n}";
const BLEIBT = "export function bleibt(y) {\n  return y;\n}";
const AUS_NEU = 'export { rechne } from "./rechnen.js";';
const AUS_ZWEITE = 'export { bleibt } from "./bleiben.js";';

function datei(...teile) {
  return `${teile.join("\n\n")}\n`;
}

function eintraege(werte) {
  return Object.fromEntries(
    Object.entries(werte).map(([pfad, regeln]) => [
      pfad,
      Object.fromEntries(Object.entries(regeln).map(([regel, count]) => [regel, { count }])),
    ]),
  );
}

function liste(werte) {
  return { [UNTERDRUECKUNGEN]: `${JSON.stringify(eintraege(werte))}\n` };
}

function basisRepo(context, konfig) {
  const repo = probeRepository(context, {
    ".gitignore": "node_modules\ntools\n",
    "package.json": `${JSON.stringify({ type: "module" })}\n`,
    "eslint.config.js": konfig,
    "eslint-suppressions.empty.json": "{}\n",
    "eslint-legacy-exceptions.json": "{}\n",
    [TOR]: readFileSync(join(REPO_ROOT, TOR), "utf8"),
    [HILFE]: datei(KURZ, RECHNE, BLEIBT),
    ...liste({ [HILFE]: { "id-length": 2, "no-magic-numbers": 1 } }),
  });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  symlinkSync(join(REPO_ROOT, "tools"), join(repo, "tools"));
  return repo;
}

function lauf(repo, argumente) {
  const ergebnis = runIn(repo, process.execPath, [TOR, ...argumente]);
  return { status: ergebnis.status, ausgabe: `${ergebnis.stdout}${ergebnis.stderr}` };
}

const AUSGELAGERT = { [HILFE]: datei(AUS_NEU, BLEIBT), [NEU]: datei(KURZ, RECHNE) };
const VERSCHOBEN = { [HILFE]: { "id-length": 1 }, [NEU]: { "id-length": 1, "no-magic-numbers": 1 } };

function ciWeg(context, { dateien = AUSGELAGERT, eintraegeNachher = VERSCHOBEN, konfig = KONFIG } = {}) {
  const repo = basisRepo(context, konfig);
  writeFiles(repo, { ...dateien, ...liste(eintraegeNachher) });
  commitAll(repo, "Auslagerung");
  return lauf(repo, ["--basis", "HEAD~1"]);
}

test("CI-Weg: Einträge ziehen mit ihrer wortgleich ausgelagerten Funktion um, gleiche Regel und Zahl ist grün", (context) => {
  istGruen(ciWeg(context));
});

test("pre-commit-Weg: die vorgemerkte Auslagerung mit umgezogenen Einträgen ist grün", (context) => {
  const repo = basisRepo(context, KONFIG);
  writeFiles(repo, { ...AUSGELAGERT, ...liste(VERSCHOBEN) });
  assert.equal(runIn(repo, "git", ["add", "-A"]).status, 0);
  istGruen(lauf(repo, [HILFE, NEU]));
});

test("pre-commit-Weg: ist die vorgemerkte Funktion geändert, ist es rot, auch wenn der Arbeitsbaum rein ist", (context) => {
  const repo = basisRepo(context, KONFIG);
  writeFiles(repo, { ...AUSGELAGERT, [NEU]: datei(KURZ.replace("x * 60", "x * 60 + x"), RECHNE), ...liste(VERSCHOBEN) });
  assert.equal(runIn(repo, "git", ["add", "-A"]).status, 0);
  writeFiles(repo, AUSGELAGERT);
  const ergebnis = lauf(repo, [HILFE, NEU]);
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /^ {2}src\/rechnen\.js -> id-length: 0 -> 1$/m);
});

test("CI-Weg: bleibt der alte Eintrag stehen, zählen alte und neue Datei zusammen und es ist rot", (context) => {
  const ergebnis = ciWeg(context, { eintraegeNachher: { ...VERSCHOBEN, [HILFE]: { "id-length": 2 } } });
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /src\/rechnen\.js \(ausgelagert aus src\/werte\.js\) -> id-length: 2 -> 3/);
});

test("CI-Weg: eine Regel, die die alte Datei nicht hatte, ist ein neuer Eintrag und rot", (context) => {
  const ergebnis = ciWeg(context, { eintraegeNachher: { ...VERSCHOBEN, [NEU]: { ...VERSCHOBEN[NEU], complexity: 1 } } });
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /src\/rechnen\.js \(ausgelagert aus src\/werte\.js\) -> complexity: 0 -> 1/);
});

test("CI-Weg: ist die Funktion beim Auslagern geändert, gilt der Eintrag als neu und ist rot", (context) => {
  const geaendert = { ...AUSGELAGERT, [NEU]: datei(KURZ.replace("x * 60", "x * 61"), RECHNE) };
  const ergebnis = ciWeg(context, { dateien: geaendert });
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /^ {2}src\/rechnen\.js -> id-length: 0 -> 1$/m);
});

test("CI-Weg: wandert ein Eintrag ohne seine Funktion, passt er nicht zu den Befunden der neuen Datei und ist rot", (context) => {
  const ohneFunktion = { [HILFE]: datei(KURZ, RECHNE, AUS_ZWEITE), [ZWEITE]: datei(BLEIBT) };
  const ergebnis = ciWeg(context, {
    dateien: ohneFunktion,
    eintraegeNachher: { [HILFE]: { "id-length": 1 }, [ZWEITE]: { "id-length": 1, "no-magic-numbers": 1 } },
  });
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /src\/bleiben\.js \(ausgelagert aus src\/werte\.js\) -> no-magic-numbers: Eintrag 1, Befunde 0/);
});

test("CI-Weg: stimmt die Summe, aber die Regel nicht, ist es rot", (context) => {
  const ergebnis = ciWeg(context, {
    eintraegeNachher: { [HILFE]: { "no-magic-numbers": 1 }, [NEU]: { "id-length": 2 } },
  });
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /src\/rechnen\.js \(ausgelagert aus src\/werte\.js\) -> id-length: Eintrag 2, Befunde 1/);
});

const KURZ_ABGESCHALTET = "function kurz(x) {\n  // eslint-disable-next-line no-magic-numbers\n  const teil = x * 7;\n  return teil * 60;\n}";

test("CI-Weg: per eslint-disable abgeschaltete Befunde zählen nicht zum Eintrag der neuen Datei", (context) => {
  const repo = basisRepo(context, KONFIG);
  writeFiles(repo, { [HILFE]: datei(KURZ_ABGESCHALTET, RECHNE, BLEIBT) });
  commitAll(repo, "Abgeschaltet");
  writeFiles(repo, { [HILFE]: datei(AUS_NEU, BLEIBT), [NEU]: datei(KURZ_ABGESCHALTET, RECHNE), ...liste(VERSCHOBEN) });
  commitAll(repo, "Auslagerung");
  istGruen(lauf(repo, ["--basis", "HEAD~1"]));
});

test("CI-Weg: zwei neue Dateien aus derselben Datei zählen zusammen mit dem Rest der alten Datei", (context) => {
  const zwei = { [HILFE]: datei(AUS_ZWEITE, AUS_NEU), [NEU]: datei(KURZ, RECHNE), [ZWEITE]: datei(BLEIBT) };
  const ergebnis = ciWeg(context, {
    dateien: zwei,
    eintraegeNachher: { [HILFE]: { "id-length": 1 }, [NEU]: VERSCHOBEN[NEU], [ZWEITE]: { "id-length": 1 } },
  });
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /\(ausgelagert aus src\/werte\.js\) -> id-length: 2 -> 3/);
});

test("CI-Weg: gelten für die neue Datei andere Regeln als für die alte, zieht kein Eintrag um", (context) => {
  const anders = `export default [{ files: ["**/*.js"], rules: ${REGELN} }, { files: ["${NEU}"], rules: { "no-magic-numbers": "warn" } }];\n`;
  const ergebnis = ciWeg(context, { konfig: anders });
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /^ {2}src\/rechnen\.js -> id-length: 0 -> 1$/m);
});

const LISTENUMZUG = join(REPO_ROOT, "tools/auftrag/listenumzug.mjs");

function umzugImArbeitsbaum(context, { dateien = AUSGELAGERT, konfig = KONFIG } = {}) {
  const repo = basisRepo(context, konfig);
  writeFiles(repo, dateien);
  const ergebnis = runIn(repo, process.execPath, [LISTENUMZUG, "--basis", "HEAD"]);
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  return { repo, liste: JSON.parse(readFileSync(join(repo, UNTERDRUECKUNGEN), "utf8")), ausgabe: ergebnis.stdout };
}

test("Listenumzug: schreibt die Einträge der ausgelagerten Funktion genau so, wie die Prüfung sie verlangt", (context) => {
  const { repo, liste, ausgabe } = umzugImArbeitsbaum(context);
  assert.deepEqual(liste, eintraege(VERSCHOBEN));
  assert.match(ausgabe, /eslint-suppressions\.json: 2 Einträge mit ihren wortgleich ausgelagerten Funktionen umgezogen\./);
  commitAll(repo, "Auslagerung");
  istGruen(lauf(repo, ["--basis", "HEAD~1"]));
});

test("Listenumzug: ohne reine Auslagerung oder bei anderen Regeln bleibt die Liste", (context) => {
  const geaendert = umzugImArbeitsbaum(context, { dateien: { ...AUSGELAGERT, [NEU]: datei(KURZ.replace("x * 60", "x * 61"), RECHNE) } });
  assert.deepEqual(geaendert.liste, eintraege({ [HILFE]: { "id-length": 2, "no-magic-numbers": 1 } }));
  const anders = `export default [{ files: ["**/*.js"], rules: ${REGELN} }, { files: ["${NEU}"], rules: { "no-magic-numbers": "warn" } }];\n`;
  const andereRegeln = umzugImArbeitsbaum(context, { konfig: anders });
  assert.deepEqual(andereRegeln.liste, eintraege({ [HILFE]: { "id-length": 2, "no-magic-numbers": 1 } }));
});
