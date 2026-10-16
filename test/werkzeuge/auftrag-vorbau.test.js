import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zusicherungenJeFall } from "../../tools/auftrag/testtitel.mjs";

import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
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

function lauf(context, drehbuch) {
  const repo = probeRepository(context, REPO);
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

test("Vorbau: meldet der Bau-Agent einen alten Test, dessen Vorbau kollidiert, läuft erst ein testumbau und dann der Auftrag grün", (context) => {
  const test = [ROTER_TEST, { dateien: { [ALT]: alterTest("{ gates: true }") } }, ROTER_TEST];
  const { repo, ergebnis, beleg, log } = lauf(context, { bau: BAU, test, plan: [{ antwort: JSON.stringify(UMBAU) }] });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.equal(beleg("A1-plan").grund, MELDUNG);
  assert.deepEqual([beleg("A1-umbau").ergebnis, beleg("A1").ergebnis], ["grün", "grün"]);
  assert.equal(log.includes(UMBAU.ziel), true);
  assert.match(readFileSync(join(repo, ALT), "utf8"), /gates: true[\s\S]*versendet den Code[\s\S]*true\)/);
});

test("Vorbau: hält der alte Test echtes altes Verhalten fest, geht die Meldung ohne Testumbau zu Antonio", (context) => {
  const plan = [{ antwort: "Verhalten: Der Test hält genau den Versand ohne Gates fest." }];
  const { ergebnis, beleg, log } = lauf(context, { bau: BAU, test: [ROTER_TEST], plan });
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(beleg("A1-umbau"), null);
  const { text } = beleg("A1").entscheidung;
  assert.match(text, /Label verhalten-geaendert am Issue mit test\/versand\.test\.js:versendet den Code/);
  assert.match(text, /Kein testumbau vorweg: Der Plan-Agent lieferte kein lesbares JSON-Objekt\./);
  assert.equal(log.includes(UMBAU.ziel), false);
});

test("Vorbau: benennt der testumbau den gemeldeten Fall um, wird er verworfen und Antonio entscheidet", (context) => {
  const umbenannt = { dateien: { [ALT]: alterTest("{ gates: true }", "versendet mit Gates") }, antwort: `Entfernt: ${ALT}: versendet den Code, weil er jetzt mit Gates heißt` };
  const { ergebnis, beleg, log } = lauf(context, { bau: BAU, test: [ROTER_TEST, umbenannt], plan: [{ antwort: JSON.stringify(UMBAU) }] });
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(beleg("A1-umbau").ergebnis, "grün");
  assert.match(beleg("A1").entscheidung.text, /hat den Fall versendet den Code entfernt oder umbenannt; er ist verworfen\./);
  assert.equal(log.includes(UMBAU.ziel), false);
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
  assert.equal(gh.filter(([befehl]) => befehl === "issue").length, 2);
  assert.equal(log.includes(UMBAU.ziel), false);
});

test("Vorbau: schwächt der testumbau eine Zusicherung des alten Tests ab, wird er verworfen und Antonio entscheidet", (context) => {
  const schwach = { dateien: { [ALT]: `${KOPF}const KUNDE = { gates: true };\ntest("versendet den Code", () => assert.ok(typeof versende(KUNDE) === "boolean"));\n` } };
  const { ergebnis, beleg, log } = lauf(context, { bau: BAU, test: [ROTER_TEST, schwach], plan: [{ antwort: JSON.stringify(UMBAU) }] });
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(beleg("A1-umbau").ergebnis, "grün");
  assert.match(beleg("A1").entscheidung.text, /ändert Fälle oder Zusicherungen in test\/versand\.test\.js; er ist verworfen\./);
  assert.equal(log.includes(UMBAU.ziel), false);
});

test("Zusicherungen je Fall: Vorbau und Einrückung zählen nicht, gestrichene, geänderte, verschobene Zusicherungen und neue Fälle schon", () => {
  const alt = `${KOPF}const KUNDE = {};\ntest("a", () => {\n  assert.equal(versende(KUNDE), true);\n});\ntest("b", (t) => t.assert.ok(KUNDE));\n`;
  const gleich = (neu) => JSON.stringify(zusicherungenJeFall(alt)) === JSON.stringify(zusicherungenJeFall(neu));
  assert.equal(gleich(alt.replace("const KUNDE = {}", "const KUNDE = { gates: true }").replace("  assert", "    assert")), true);
  assert.equal(gleich(alt.replace("assert.equal(versende(KUNDE), true);", "")), false);
  assert.equal(gleich(alt.replace("assert.equal(versende(KUNDE), true)", "assert.ok(versende(KUNDE))")), false);
  assert.equal(gleich(alt.replace('test("b", (t) => t.assert.ok(KUNDE))', 'test("b", () => {});\ntest("c", (t) => t.assert.ok(KUNDE))')), false);
  assert.equal(gleich(`${alt}test("d", () => {});\n`), false);
  assert.equal(zusicherungenJeFall("kaputt("), null);
});
