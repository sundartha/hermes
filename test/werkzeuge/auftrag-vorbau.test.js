import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zusicherungenGleich } from "../../tools/auftrag/testtitel.mjs";

import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const GH_AUFRUFE_JE_NOTIZ = 2;
const SAETZE_UEBER_DER_KUERZUNGSGRENZE = 40;
const ISSUE = 54;
const PROBE = "probe@example.invalid";

const CLAUDE = `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const ort = dirname(process.env.ERSATZ_DREHBUCH);
const rolle = process.env.HERMES_ROLLE;
const zaehler = join(ort, "anzahl-" + rolle);
const nummer = existsSync(zaehler) ? Number(readFileSync(zaehler, "utf8")) : 0;
writeFileSync(zaehler, String(nummer + 1));
readFileSync(0, "utf8");
const liste = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"))[rolle] ?? [{}];
const einsatz = liste[Math.min(nummer, liste.length - 1)];
for (const [pfad, inhalt] of Object.entries(einsatz.dateien ?? {})) writeFileSync(pfad, inhalt);
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: einsatz.antwort ?? "fertig" }) + "\\n");
`;

const GH = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const eingabe = process.argv.includes("-") ? readFileSync(0, "utf8") : "";
appendFileSync(process.env.ERSATZ_GH, JSON.stringify([...process.argv.slice(2), eingabe]) + "\\n");
`;

const VERSAND = "src/versand.js";
const ALT = "test/versand.test.js";
const NEU = "test/versand-gates.test.js";
const KOPF = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { versende } from "../src/versand.js";\n';
const alterTest = (kunde, name = "versendet den Code") => `${KOPF}const KUNDE = ${kunde};\ntest("${name}", () => assert.equal(versende(KUNDE), true));\n`;
const REPO = {
  ".gitignore": ".fortschritt/\n",
  [VERSAND]: "export function versende(kunde) {\n  return kunde !== null;\n}\n",
  [ALT]: alterTest("{}"),
  "package.json": JSON.stringify({ type: "module", scripts: { lint: "node -e 0", "test:betroffen": "node -e 0 --", test: "node --test" } }),
};
const AUFTRAG = {
  id: "A1",
  art: "funktion",
  ziel: "Versende ohne Gates keinen Code",
  bereich: VERSAND,
  erwarteteDateien: [VERSAND, NEU],
  abnahme: NEU,
  erwarteterFehler: "true !== false",
  wasDarfNiePassieren: [],
};
const ROTER_TEST = { dateien: { [NEU]: `${KOPF}test("ohne Gates kein Code", () => assert.equal(versende({}), false));\n` } };
const GATES = { dateien: { [VERSAND]: "export function versende(kunde) {\n  return kunde.gates === true;\n}\n" } };
const MELDUNG = `Alter Test hält altes Verhalten fest: ${ALT}:versendet den Code – der Vorbau hat keine Gates`;
const BAU = [{ ...GATES, antwort: MELDUNG }, GATES];
const UMBAU = { ziel: "Gib dem Testkunden bestandene Gates", bereich: ALT, erwarteteDateien: [ALT], abnahme: ALT, entwurf: "Vorbau mit Gates." };

const ERSATZ = { HERMES_CLAUDE: "claude.mjs", HERMES_GH: "gh.mjs", ERSATZ_DREHBUCH: "drehbuch.json", ERSATZ_GH: "gh.log" };
const IDENTITAET = { GIT_AUTHOR_NAME: "Probe", GIT_AUTHOR_EMAIL: PROBE, GIT_COMMITTER_NAME: "Probe", GIT_COMMITTER_EMAIL: PROBE };

function umgebung(werkzeug) {
  const ersatz = Object.entries(ERSATZ).map(([name, datei]) => [name, join(werkzeug, datei)]);
  return { ...isolatedEnvironment(), HOME: werkzeug, ...Object.fromEntries(ersatz), ...IDENTITAET };
}

function lauf(context, drehbuch, dateien = REPO) {
  const repo = probeRepository(context, dateien);
  const phase = { phase: "probe", issue: ISSUE, entwurf: { [VERSAND]: "Entwurf." }, auftraege: [AUFTRAG] };
  const werkzeug = probeDirectory(context, { "claude.mjs": CLAUDE, "gh.mjs": GH, "drehbuch.json": JSON.stringify(drehbuch), "phase.json": JSON.stringify(phase) });
  for (const name of ["claude.mjs", "gh.mjs"]) chmodSync(join(werkzeug, name), AUSFUEHRBAR);
  const einstieg = [join(REPO_ROOT, "tools/auftrag.mjs"), "lauf", join(werkzeug, "phase.json")];
  const ergebnis = spawnSync(process.execPath, einstieg, { cwd: repo, encoding: "utf8", env: umgebung(werkzeug) });
  const pfad = (name) => join(repo, ".fortschritt/probe", `${name}.json`);
  const beleg = (name) => (existsSync(pfad(name)) ? JSON.parse(readFileSync(pfad(name), "utf8")) : null);
  const log = runIn(repo, "git", ["log", "--format=%s"]).stdout.trim().split("\n");
  const ghLog = join(werkzeug, "gh.log");
  const gh = existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile)) : [];
  return { repo, ergebnis, beleg, log, gh };
}

function vorwegVerworfen(context, testumbau, { bau = BAU, dateien = REPO } = {}) {
  const { ergebnis, beleg, log } = lauf(context, { bau, test: [ROTER_TEST, testumbau], plan: [{ antwort: JSON.stringify(UMBAU) }] }, dateien);
  assert.equal(ergebnis.status, EXIT_ROT);
  const umbau = beleg("A1-umbau");
  assert.equal(umbau.ergebnis, "rot");
  assert.deepEqual(umbau.pruefungen.filter(({ exitCode }) => exitCode !== 0).map(({ name }) => name), ["vorbau nur ergänzt"]);
  assert.match(beleg("A1").entscheidung.text, /Der testumbau A1-umbau vorweg ist gescheitert \(rot\)/);
  assert.equal(log.includes(UMBAU.ziel), false);
  return { umbau, notiz: beleg("A1").entscheidung.text };
}

test("Vorbau: meldet der Bau-Agent einen alten Test, dessen Vorbau kollidiert, läuft erst ein testumbau und dann der Auftrag grün", (context) => {
  const einsaetzeTestAgent = [ROTER_TEST, { dateien: { [ALT]: alterTest("{ gates: true }") } }, ROTER_TEST];
  const { repo, ergebnis, beleg, log } = lauf(context, { bau: BAU, test: einsaetzeTestAgent, plan: [{ antwort: JSON.stringify(UMBAU) }] });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.equal(beleg("A1-plan").grund, MELDUNG);
  assert.deepEqual([beleg("A1-umbau").ergebnis, beleg("A1").ergebnis], ["grün", "grün"]);
  assert.equal(log.includes(UMBAU.ziel), true);
  assert.match(readFileSync(join(repo, ALT), "utf8"), /gates: true[\s\S]*versendet den Code[\s\S]*true\)/);
});

test("Vorbau: der Beleg des Plans enthält die volle Antwort des Plan-Agenten, die Belege der übrigen Agenten nicht", (context) => {
  const einsaetzeTestAgent = [ROTER_TEST, { dateien: { [ALT]: alterTest("{ gates: true }") } }, ROTER_TEST];
  const { ergebnis, beleg } = lauf(context, { bau: BAU, test: einsaetzeTestAgent, plan: [{ antwort: JSON.stringify(UMBAU) }] });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.deepEqual(beleg("A1-plan").agenten.map(({ volleAntwort }) => volleAntwort), [JSON.stringify(UMBAU)]);
  const uebrige = ["A1-umbau", "A1"].flatMap((name) => [...beleg(name).agenten, ...beleg(name).nachfragen]);
  assert.deepEqual([uebrige.length > 0, uebrige.filter((agent) => "volleAntwort" in agent)], [true, []]);
});

test("Vorbau: hält der alte Test echtes altes Verhalten fest, geht die Meldung ohne Testumbau zu Antonio", (context) => {
  const plan = [{ antwort: "Verhalten: Der Test hält genau den Versand ohne Gates fest." }];
  const { ergebnis, beleg, log } = lauf(context, { bau: BAU, test: [ROTER_TEST], plan });
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(beleg("A1-umbau"), null);
  const { text } = beleg("A1").entscheidung;
  assert.match(text, /Label verhalten-geaendert am Issue mit test\/versand\.test\.js:versendet den Code/);
  assert.match(text, /Kein testumbau vorweg: Der Plan-Agent sieht echtes Verhalten: Der Test hält genau den Versand ohne Gates fest\./);
  assert.equal(log.includes(UMBAU.ziel), false);
});

test("Vorbau: benennt der testumbau den gemeldeten Fall um, wird er verworfen und Antonio entscheidet", (context) => {
  const umbenannt = { dateien: { [ALT]: alterTest("{ gates: true }", "versendet mit Gates") }, antwort: `Entfernt: ${ALT}: versendet den Code, weil er jetzt mit Gates heißt` };
  const { notiz } = vorwegVerworfen(context, umbenannt);
  assert.match(notiz, /test\/versand\.test\.js:versendet den Code/);
});

test("Vorbau: nach einem verworfenen testumbau zitiert die Notiz an Antonio den Anfang einer langen Antwort des Bau-Agenten", (context) => {
  const lang = `Hinweis vom Anfang der Bau-Antwort.\n${"Weitere Erklärung des Bau-Agenten. ".repeat(SAETZE_UEBER_DER_KUERZUNGSGRENZE)}\n${MELDUNG}`;
  const umbenannt = { dateien: { [ALT]: alterTest("{ gates: true }", "versendet mit Gates") }, antwort: `Entfernt: ${ALT}: versendet den Code, weil er jetzt mit Gates heißt` };
  const { notiz } = vorwegVerworfen(context, umbenannt, { bau: [{ ...GATES, antwort: lang }] });
  assert.match(notiz, /Hinweise des Bau-Agenten:\n> Hinweis vom Anfang der Bau-Antwort\./);
});

test("Vorbau: meldet der Bau-Agent den alten Test nach einem grünen testumbau erneut, nennt die Notiz an Antonio den Grund", (context) => {
  const nie = { dateien: { [VERSAND]: "export function versende() {\n  return false;\n}\n" }, antwort: MELDUNG };
  const einsaetzeTestAgent = [ROTER_TEST, { dateien: { [ALT]: alterTest("{ gates: true }") } }, ROTER_TEST];
  const { ergebnis, beleg } = lauf(context, { bau: [{ ...GATES, antwort: MELDUNG }, nie], test: einsaetzeTestAgent, plan: [{ antwort: JSON.stringify(UMBAU) }] });
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(beleg("A1-umbau").ergebnis, "grün");
  assert.match(beleg("A1").entscheidung.text, /Kein testumbau vorweg: der eine testumbau dieses Auftrags ist schon gelaufen\./);
});

test("Vorbau: scheitert der testumbau, bekommt Antonio genau eine Notiz zum alten Test", (context) => {
  const kaputt = { dateien: { [ALT]: alterTest("null") } };
  const { ergebnis, beleg, log, gh } = lauf(context, { bau: BAU, test: [ROTER_TEST, kaputt], plan: [{ antwort: JSON.stringify(UMBAU) }] });
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(beleg("A1-umbau").ergebnis, "rot");
  assert.match(beleg("A1").entscheidung.text, /Der testumbau A1-umbau vorweg ist gescheitert \(rot\); sein Beleg heißt A1-umbau\./);
  assert.equal(gh.filter(([befehl]) => befehl === "issue").length, GH_AUFRUFE_JE_NOTIZ);
  assert.equal(log.includes(UMBAU.ziel), false);
});

test("Vorbau: schwächt der testumbau eine Zusicherung des alten Tests ab, wird er verworfen und Antonio entscheidet", (context) => {
  const schwach = { dateien: { [ALT]: `${KOPF}const KUNDE = { gates: true };\ntest("versendet den Code", () => assert.ok(typeof versende(KUNDE) === "boolean"));\n` } };
  const { notiz } = vorwegVerworfen(context, schwach);
  assert.match(notiz, /Label verhalten-geaendert am Issue mit test\/versand\.test\.js:versendet den Code/);
});

test("Vorbau: ändert der testumbau den Rumpf einer bestehenden Hilfe, ist seine Runde vor der Mutationsprüfung rot und der Test-Agent erfährt, was erlaubt ist", (context) => {
  const paket = JSON.parse(REPO["package.json"]);
  const mitHilfe = (rumpf) => `${KOPF}function kunde() {\n  return ${rumpf};\n}\ntest("versendet den Code", () => assert.equal(versende(kunde()), true));\n`;
  const dateien = { ...REPO, [ALT]: mitHilfe("{}"), "package.json": JSON.stringify({ ...paket, scripts: { ...paket.scripts, "test:mutation": "node -e 0 --" } }) };
  const { umbau } = vorwegVerworfen(context, { dateien: { [ALT]: mitHilfe("{ gates: true }") } }, { dateien });
  assert.equal(umbau.pruefungen.some(({ name }) => name === "mutation testumbau"), false);
  assert.match(umbau.runden[0], /neue Hilfe, ein neuer Import oder ein ergänzter Wert einer bestehenden Belegung/);
});

test("Zusicherungen je Fall: Einrückung zählt nicht, gestrichene, geänderte, verschobene Zusicherungen, neue Fälle und ein Vorbau, den eine Zusicherung direkt prüft, schon", () => {
  const alt = `${KOPF}const KUNDE = {};\ntest("a", () => {\n  assert.equal(versende(KUNDE), true);\n});\ntest("b", (t) => t.assert.ok(KUNDE));\n`;
  const gleich = (neu) => zusicherungenGleich(alt, neu);
  assert.equal(gleich(alt.replace("  assert", "    assert")), true);
  assert.equal(gleich(alt.replace("const KUNDE = {}", "const KUNDE = { gates: true }")), false);
  assert.equal(gleich(alt.replace("assert.equal(versende(KUNDE), true);", "")), false);
  assert.equal(gleich(alt.replace("assert.equal(versende(KUNDE), true)", "assert.ok(versende(KUNDE))")), false);
  assert.equal(gleich(alt.replace('test("b", (t) => t.assert.ok(KUNDE))', 'test("b", () => {});\ntest("c", (t) => t.assert.ok(KUNDE))')), false);
  assert.equal(gleich(`${alt}test("d", () => {});\n`), false);
  assert.equal(zusicherungenGleich("kaputt(", "kaputt("), false);
});

test("Zusicherungen je Fall: ein gestrichenes await vor einer Zusicherung und eine abgeschaltete expect-Zusicherung zählen als Änderung", () => {
  const alt = `${KOPF}test("a", async () => {\n  await assert.rejects(versende({}));\n  expect(versende({})).toBe(true);\n});\n`;
  const gleich = (neu) => zusicherungenGleich(alt, neu);
  assert.deepEqual(
    [gleich(alt.replace("  await", "    await")), gleich(alt.replace("await assert", "assert")), gleich(alt.replace("  expect", "  if (false) expect"))],
    [true, false, false],
  );
});

test("Zusicherungen je Fall: ein abgeschalteter Fall, eine Zusicherung hinter Steuerung oder Sprung, eine Attrappe für assert, eine gestrichene Prüfhilfe, eine geänderte Hilfe und ein Vorbau im Fall, den eine Zusicherung direkt prüft, zählen als Änderung, eine neue Hilfe nicht", () => {
  const alt = `${KOPF}function kunde() {\n  return {};\n}\nfunction pruefe(geprueft) {\n  assert.ok(geprueft);\n}\ntest("a", (t) => {\n  const testkunde = {};\n  pruefe(testkunde);\n  assert.equal(versende(testkunde), true);\n  t.assert.ok(testkunde);\n});\n`;
  const gleich = (neu) => zusicherungenGleich(alt, neu);
  const ZUSICHERUNG = "assert.equal(versende(testkunde), true);";
  const VORBAU = "const testkunde = {};";
  const FALL = /test\("a"[^]*\n\}\);\n/;
  const faelle = [
    ['test("a", (t) => {', 'test.skip("a", (t) => {', false],
    ['test("a", (t) => {', 'test.todo("a", (t) => {', false],
    ['test("a", (t) => {', 'test("a", { skip: true }, (t) => {', false],
    [FALL, "if (process.env.NIE) {\n$&}\n", false],
    [FALL, 'describe("Hülle", { skip: true }, () => {\n$&});\n', false],
    [ZUSICHERUNG, `try { ${ZUSICHERUNG} } catch {}`, false],
    [ZUSICHERUNG, `if (false) ${ZUSICHERUNG}`, false],
    [ZUSICHERUNG, `t.skip(); ${ZUSICHERUNG}`, false],
    [ZUSICHERUNG, `(() => { ${ZUSICHERUNG} });`, false],
    [ZUSICHERUNG, `[].forEach(() => { ${ZUSICHERUNG} });`, false],
    [ZUSICHERUNG, `return; ${ZUSICHERUNG}`, false],
    [ZUSICHERUNG, `aus: { break aus; ${ZUSICHERUNG} }`, false],
    [VORBAU, "const testkunde = { gates: true };", false],
    ["return {};", "return { gates: true };", false],
    ['"node:assert/strict"', '"node:assert"', false],
    ["  assert.ok(geprueft);", "  return;\n  assert.ok(geprueft);", false],
    ["  assert.ok(geprueft);", '  throw new Error("aus");\n  assert.ok(geprueft);', false],
    [VORBAU, `const assert = { equal() {} };\n  ${VORBAU}`, false],
    [VORBAU, `assert.equal = () => {};\n  ${VORBAU}`, false],
    [VORBAU, `Object.assign(assert, { equal() {} });\n  ${VORBAU}`, false],
    [VORBAU, `const pruefe = () => {};\n  ${VORBAU}`, false],
    [VORBAU, `const nachgiebig = assert;\n  nachgiebig.equal = () => {};\n  ${VORBAU}`, false],
    [VORBAU, `class assert {\n    static equal() {}\n  }\n  ${VORBAU}`, false],
    ["  pruefe(testkunde);\n", "", false],
    ['test("a", (t) => {', 'test("a", (t = { assert: { ok() {} } }) => {', false],
    ["function kunde() {", "function kundin() {\n  return { gates: true };\n}\nfunction kunde() {", true],
    ['import { test } from "node:test";', 'import { test } from "node:test";\nimport { join } from "node:path";', true],
  ];
  assert.deepEqual(
    faelle.map(([vorher, nachher]) => gleich(alt.replace(vorher, nachher))),
    faelle.map(([, , erwartet]) => erwartet),
  );
});

test("Oberste Ebene: neue Hilfen, fremde Importe und ergänzte Werte zählen nicht, jede andere Änderung außerhalb der Fälle schon", () => {
  const alt = `${KOPF}const FAELLE = [1, 2, 3];\nconst KUNDE = { gates: false, adresse: { land: "DE" } };\nfunction kunde() {\n  return KUNDE;\n}\ntest("a", () => assert.equal(versende(kunde()), FAELLE.length > 0));\n`;
  const ECHTER_UMBAU = '$&import { join } from "node:path";\nfunction ordner() {\n  return join("a");\n}\n';
  const faelle = [
    ["const FAELLE = [1, 2, 3];", "const FAELLE = [1, 2, 3, 4];", false],
    ['adresse: { land: "DE" } }', 'adresse: { land: "DE", ort: "Bonn" }, tarif: "pro" }', true],
    ['import { versende } from "../src/versand.js";\n', ECHTER_UMBAU, true],
    ["function kunde() {", 'const LAND = "DE";\nfunction kunde() {', true],
    ["const FAELLE = [1, 2, 3];", "const FAELLE = [1];", false],
    ["gates: false", "gates: true", false],
    ["const KUNDE = {", "const KUNDE = { ...FAELLE,", false],
    ["const KUNDE = {", "const KUNDE = { seit: Date.now(),", false],
    ["function kunde() {", "const SEIT = Date.now();\nfunction kunde() {", false],
    ["return KUNDE;", "return { ...KUNDE, gates: true };", false],
    ['import { test } from "node:test";', 'import { skip as test } from "node:test";', false],
    ["function kunde() {", "process.exit(0);\nfunction kunde() {", false],
    ["function kunde() {", "const nachgiebig = assert;\nnachgiebig.equal = () => {};\nfunction kunde() {", false],
  ];
  assert.deepEqual(
    faelle.map(([vorher, nachher]) => zusicherungenGleich(alt, alt.replace(vorher, nachher))),
    faelle.map(([, , erwartet]) => erwartet),
  );
  const mitArray = alt.replace("FAELLE.length > 0", "Array.isArray(FAELLE)");
  const verdeckt = ["const Array = { isArray: () => true };", "function Array() {}", 'import { isArray as Array } from "./liste.js";'];
  assert.deepEqual(
    verdeckt.map((neu) => zusicherungenGleich(mitArray, mitArray.replace("function kunde() {", `${neu}\nfunction kunde() {`))),
    [false, false, false],
  );
});

test("Umwege und fremde Objekte: ein neuer Weg zu Modulobjekten, eine neue Veränderung eines fremden oder lokalen Objekts zählt als Änderung, ein ergänzter Wert des lokalen Objekts nicht", () => {
  const VORBAU = "const testkunde = {};";
  const FALL = `test("a", () => {\n  ${VORBAU}\n  assert.equal(versende(testkunde), true);\n});\n`;
  const mitVorbau = (zeile, kopf = KOPF) => `${kopf}${FALL.replace(VORBAU, `${VORBAU}\n  ${zeile}`)}`;
  const ATTRAPPE = 'createRequire(import.meta.url)("node:assert/strict").equal = () => {};';
  const faelle = [
    [`${KOPF}${FALL.replace("{};", "{ gates: true };")}`, true],
    [mitVorbau("testkunde.gates = true;"), false],
    [mitVorbau(ATTRAPPE, `${KOPF}import { createRequire } from "node:module";\n`), false],
    [mitVorbau(ATTRAPPE), false],
    [mitVorbau('import("node:assert").then((geladen) => {\n    geladen.default.equal = () => {};\n  });'), false],
    [mitVorbau('process.getBuiltinModule("node:assert/strict").equal = () => {};'), false],
    [mitVorbau("Object.assign(assert, { equal() {} });"), false],
    [mitVorbau("versende.vorbei = true;"), false],
    [mitVorbau('({}).constructor.constructor("return 1")();'), false],
    [mitVorbau("", `${KOPF}import { runInThisContext } from "node:vm";\n`), false],
  ];
  assert.deepEqual(
    faelle.map(([neu]) => zusicherungenGleich(`${KOPF}${FALL}`, neu)),
    faelle.map(([, erwartet]) => erwartet),
  );
});

test("Rumpf eines Falls: ein ergänzter Wert einer bestehenden Belegung zählt nicht, eine Attrappe per t.mock, Steuerung um eine Zusicherung und ein gestrichener Hilfsaufruf schon", () => {
  const PRUEFHILFE = "function pruefe(ergebnis) {\n  assert.ok(ergebnis);\n}\n";
  const PRUEFUNG = "  assert.equal(versand.versende(kunde), true);\n";
  const fall = (rumpf) => `${KOPF.replace("{ versende }", "versand")}${PRUEFHILFE}test("versendet den Code", (t) => {\n  const kunde = { gates: false };\n${rumpf}});\n`;
  const alt = fall(`  pruefe(versand.versende(kunde));\n${PRUEFUNG}`);
  const umbauten = new Map([
    ["ergänzter Wert", [alt.replace("gates: false }", 'gates: false, land: "DE" }'), true]],
    ["Attrappe", [alt.replace("  pruefe", '  t.mock.method(versand, "versende", () => true);\n  pruefe'), false]],
    ["if (false)", [alt.replace(PRUEFUNG, `  if (false) {\n  ${PRUEFUNG}  }\n`), false]],
    ["try", [alt.replace(PRUEFUNG, `  try {\n  ${PRUEFUNG}  } catch {}\n`), false]],
    ["ohne pruefe", [alt.replace("  pruefe(versand.versende(kunde));\n", ""), false]],
  ]);
  for (const [name, [neu, erwartet]] of umbauten) assert.equal(zusicherungenGleich(alt, neu), erwartet, name);
});

test("Erwartungswerte: eine ergänzte Belegung, die eine Zusicherung als Erwartung trägt, direkt, per Spread oder über eine Fall-Tabelle, zählt als Änderung, eine ergänzte Eingabe nicht", () => {
  const BELEGUNGEN = 'const EINGABE = { name: "Ada" };\nconst ERWARTET = { name: "Ada" };\nconst BASIS = { tarif: "basis" };\nconst MIT_TARIF = { ...BASIS };\nconst FAELLE = [["Ada", "basis"]];\n';
  const FALL = 'test("liefert den Kunden", () => {\n  const erwartet = [1];\n  assert.deepEqual(kunde(EINGABE), ERWARTET);\n  assert.deepEqual(versende(EINGABE), { ...MIT_TARIF, liste: erwartet });\n});\n';
  const TABELLE = "for (const [name, tarif] of FAELLE) test(`Tarif von ${name}`, () => assert.equal(kunde({ name }).tarif, tarif));\n";
  const alt = `${KOPF.replace("{ versende }", "{ kunde, versende }")}${BELEGUNGEN}${FALL}${TABELLE}`;
  const umbauten = new Map([
    ["Eingabe", ['EINGABE = { name: "Ada" }', 'EINGABE = { name: "Ada", land: "DE" }', true]],
    ["Erwartung", ['ERWARTET = { name: "Ada" }', 'ERWARTET = { name: "Ada", tarif: "pro" }', false]],
    ["Erwartung im Fall", ["erwartet = [1]", "erwartet = [1, 2]", false]],
    ["Spread", ['BASIS = { tarif: "basis" }', 'BASIS = { tarif: "basis", rabatt: 1 }', false]],
    ["Fall-Tabelle", ['FAELLE = [["Ada", "basis"]]', 'FAELLE = [["Ada", "basis"], ["Bob", "pro"]]', false]],
  ]);
  for (const [name, [vorher, nachher, erwartet]] of umbauten) assert.equal(zusicherungenGleich(alt, alt.replace(vorher, nachher)), erwartet, name);
});

test("Testoptionen: eine Konstante, die als Option eines Falls dient, und ein neuer Schlüssel wie skip zählen als Änderung, ein ergänzter Kunde nicht", () => {
  const FALL = "() => assert.equal(versende(KUNDE), true)";
  const datei = (vorbau, optionen) => `${KOPF}${vorbau}const KUNDE = {};\ntest("a", ${optionen}, ${FALL});\n`;
  const OPTIONEN = "const OPTIONEN = { timeout: 1000 };\n";
  const MIT_SKIP = "const OPTIONEN = { timeout: 1000, skip: true };\n";
  const MIT_NAME = 'const OPTIONEN = { timeout: 1000, name: "x" };\n';
  const HILFE = "function optionen() {\n  return OPTIONEN;\n}\n";
  const BASIS = (wert) => `const BASIS = ${wert};\nconst OPTIONEN = { ...BASIS };\n`;
  const faelle = [
    [datei(OPTIONEN, "OPTIONEN"), datei(OPTIONEN, "OPTIONEN").replace("const KUNDE = {}", "const KUNDE = { gates: true }"), true],
    [datei(OPTIONEN, "OPTIONEN"), datei(MIT_SKIP, "OPTIONEN"), false],
    [datei(OPTIONEN, "OPTIONEN"), datei(MIT_NAME, "OPTIONEN"), false],
    [datei(OPTIONEN, "OPTIONEN"), datei(OPTIONEN, "{ ...OPTIONEN, skip: true }"), false],
    [datei(BASIS("{ timeout: 1000 }"), "OPTIONEN"), datei(BASIS('{ timeout: 1000, name: "x" }'), "OPTIONEN"), false],
    [datei(OPTIONEN + HILFE, "optionen()"), datei(MIT_NAME + HILFE, "optionen()"), false],
    [datei("", "{}"), datei("", "{}").replace("const KUNDE = {}", "const KUNDE = { skip: true }"), false],
  ];
  assert.deepEqual(
    faelle.map(([alt, neu]) => zusicherungenGleich(alt, neu)),
    faelle.map(([, , erwartet]) => erwartet),
  );
});
