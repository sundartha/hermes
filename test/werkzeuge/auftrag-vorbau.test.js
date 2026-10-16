import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

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
  return { repo, ergebnis, beleg, log };
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
