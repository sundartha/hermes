import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOR = "scripts/check-staged-suppressions.js";
const VORAB_HAKEN = ".githooks/pre-commit";
const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const KLEINSTER_ANSTIEG = 1;

function unterdrueckungen(zahlen) {
  const liste = {};
  for (const [datei, count] of Object.entries(zahlen)) liste[datei] = { complexity: { count } };
  return `${JSON.stringify(liste)}\n`;
}

function repoMit(context, zahlen) {
  return probeRepository(context, {
    [TOR]: readFileSync(join(REPO_ROOT, TOR), "utf8"),
    [VORAB_HAKEN]: readFileSync(join(REPO_ROOT, VORAB_HAKEN), "utf8"),
    "package.json": `${JSON.stringify({ type: "module", scripts: { lint: "true" } })}\n`,
    "eslint-legacy-exceptions.json": "{}\n",
    [UNTERDRUECKUNGEN]: unterdrueckungen(zahlen),
  });
}

function vormerken(repo, zahlen) {
  writeFiles(repo, { [UNTERDRUECKUNGEN]: unterdrueckungen(zahlen) });
  const vorgemerkt = runIn(repo, "git", ["add", UNTERDRUECKUNGEN]);
  assert.equal(vorgemerkt.status, EXIT_GRUEN, vorgemerkt.stderr);
}

function tor(repo, argumente = []) {
  const lauf = runIn(repo, process.execPath, [TOR, ...argumente]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test("Unterdrückungen: eine vorgemerkte höhere Zahl in eslint-suppressions.json ist am Tor rot", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2 });
  vormerken(repo, { "src/alt.js": 3 });
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/alt\.js -> complexity: 2 -> 3/);
});

test("Unterdrückungen: ein vorgemerkter neuer Eintrag in eslint-suppressions.json ist am Tor rot", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2 });
  vormerken(repo, { "src/alt.js": 1, "src/neu.js": 1 });
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/neu\.js -> complexity: 0 -> 1/);
});

test("Unterdrückungen: ein vorgemerkter Eintrag in eslint-suppressions.json ohne Zahl ist am Tor rot", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2 });
  writeFiles(repo, { [UNTERDRUECKUNGEN]: `${JSON.stringify({ "src/alt.js": { complexity: {} } })}\n` });
  runIn(repo, "git", ["add", UNTERDRUECKUNGEN]);
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/alt\.js -> complexity: 2 -> /);
});

test("Unterdrückungen: ein Eintrag ohne Zahl im alten Stand zählt als 0 und lässt sich streichen", (context) => {
  const statusNach = (zahlen) => {
    const repo = repoMit(context, {});
    writeFiles(repo, { [UNTERDRUECKUNGEN]: `${JSON.stringify({ "src/alt.js": { complexity: {} } })}\n` });
    commitAll(repo, "ohne Zahl");
    vormerken(repo, zahlen);
    return tor(repo).status;
  };
  const status = [{ "src/alt.js": 0 }, {}, { "src/alt.js": KLEINSTER_ANSTIEG }].map(statusNach);
  assert.deepEqual(status, [EXIT_GRUEN, EXIT_GRUEN, EXIT_ROT]);
});

test("Unterdrückungen: ein Eintrag ohne Zahl in eslint-suppressions.json bleibt rot, auch wenn er sich nicht ändert", (context) => {
  const repo = repoMit(context, {});
  writeFiles(repo, { [UNTERDRUECKUNGEN]: `${JSON.stringify({ "src/alt.js": { complexity: {} } })}\n` });
  commitAll(repo, "ohne Zahl");
  runIn(repo, "git", ["add", UNTERDRUECKUNGEN]);
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
});

test("Unterdrückungen: vorgemerktes Senken und Streichen in eslint-suppressions.json ist am Tor grün", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2, "src/weg.js": 1 });
  vormerken(repo, { "src/alt.js": 1 });
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.ausgabe);
});

test("Unterdrückungen: der Pre-Commit-Haken ist rot, wenn nur eslint-suppressions.json mit höherer Zahl vorgemerkt ist", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2 });
  vormerken(repo, { "src/alt.js": 3 });
  const haken = runIn(repo, "sh", [VORAB_HAKEN]);
  assert.equal(haken.status, EXIT_ROT, `${haken.stdout}${haken.stderr}`);
});

test("Unterdrückungen: mit --basis ist ein Branch rot, der eine Zahl erhöht, und grün, der nur senkt", (context) => {
  const erhoeht = repoMit(context, { "src/alt.js": 2, "src/b.js": 2 });
  writeFiles(erhoeht, { [UNTERDRUECKUNGEN]: unterdrueckungen({ "src/alt.js": 1, "src/b.js": 3 }) });
  commitAll(erhoeht, "erhöht");
  const gesenkt = repoMit(context, { "src/alt.js": 2, "src/b.js": 2 });
  writeFiles(gesenkt, { [UNTERDRUECKUNGEN]: unterdrueckungen({ "src/alt.js": 1 }) });
  commitAll(gesenkt, "gesenkt");
  const laeufe = [tor(erhoeht, ["--basis", "HEAD~1"]), tor(gesenkt, ["--basis", "HEAD~1"])];
  assert.deepEqual(laeufe.map(({ status }) => status), [EXIT_ROT, EXIT_GRUEN], laeufe.map(({ ausgabe }) => ausgabe).join("\n"));
  assert.match(laeufe[0].ausgabe, /src\/b\.js -> complexity: 2 -> 3/);
});

const ALTLAST = "eslint-legacy-exceptions.json";
const KOMPLEXITAET = "complexity :: Function 'f' has a complexity of 14. Maximum allowed is 10.";
const KURZER_NAME = "id-length :: Identifier name 'q' is too short (< 2).";

function altlast(pins) {
  const liste = {};
  for (const [datei, findings] of Object.entries(pins)) {
    liste[datei] = { reason: "Altlast", date: "2026-01-01", findings };
  }
  return `${JSON.stringify(liste)}\n`;
}

function repoMitAltlast(context, pins) {
  const repo = repoMit(context, {});
  writeFiles(repo, { [ALTLAST]: altlast(pins) });
  commitAll(repo, "Altlast");
  return repo;
}

function vormerkenAltlast(repo, pins) {
  writeFiles(repo, { [ALTLAST]: altlast(pins) });
  const vorgemerkt = runIn(repo, "git", ["add", ALTLAST]);
  assert.equal(vorgemerkt.status, EXIT_GRUEN, vorgemerkt.stderr);
}

function torNachAltlast(context, vorher, nachher) {
  const repo = repoMitAltlast(context, vorher);
  vormerkenAltlast(repo, nachher);
  return tor(repo);
}

test("Unterdrückungen: ein vorgemerkter höherer Pin in eslint-legacy-exceptions.json ist am Tor rot", (context) => {
  const lauf = torNachAltlast(
    context,
    { "src/alt.js": { [KOMPLEXITAET]: 1 } },
    { "src/alt.js": { [KOMPLEXITAET]: 2 } },
  );
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /in eslint-legacy-exceptions\.json steigen Zahlen/);
  assert.match(lauf.ausgabe, /src\/alt\.js -> complexity :: Function 'f'.*: 1 -> 2/);
});

test("Unterdrückungen: ein vorgemerkter neuer Befund im Pin einer Datei ist am Tor rot", (context) => {
  const lauf = torNachAltlast(
    context,
    { "src/alt.js": { [KOMPLEXITAET]: 1 } },
    { "src/alt.js": { [KOMPLEXITAET]: 1, [KURZER_NAME]: 1 } },
  );
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/alt\.js -> id-length :: Identifier name 'q'.*: 0 -> 1/);
});

test("Unterdrückungen: ein vorgemerkter neuer Altlast-Eintrag für eine Datei ist am Tor rot", (context) => {
  const lauf = torNachAltlast(
    context,
    { "src/alt.js": { [KOMPLEXITAET]: 1 } },
    { "src/alt.js": { [KOMPLEXITAET]: 1 }, "src/neu.js": { [KOMPLEXITAET]: 1 } },
  );
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/neu\.js -> complexity :: Function 'f'.*: 0 -> 1/);
});

test("Unterdrückungen: ein vorgemerkter neuer Altlast-Eintrag ohne zählbare Befunde ist am Tor rot", (context) => {
  for (const findings of [undefined, {}, 5]) {
    const lauf = torNachAltlast(
      context,
      { "src/alt.js": { [KOMPLEXITAET]: 1 } },
      { "src/alt.js": { [KOMPLEXITAET]: 1 }, "src/neu.js": findings },
    );
    assert.equal(lauf.status, EXIT_ROT, `${JSON.stringify(findings)}: ${lauf.ausgabe}`);
    assert.match(lauf.ausgabe, /src\/neu\.js -> Altlast-Eintrag: 0 -> 1/);
  }
});

test("Unterdrückungen: ein vorgemerkter Pin, der keine Zahl ist, ist am Tor rot", (context) => {
  for (const wert of ["viele", true, null, "0", "", 1.5, -1]) {
    const lauf = torNachAltlast(
      context,
      { "src/alt.js": { [KOMPLEXITAET]: 1 } },
      { "src/alt.js": { [KOMPLEXITAET]: wert } },
    );
    assert.equal(lauf.status, EXIT_ROT, `${JSON.stringify(wert)}: ${lauf.ausgabe}`);
    assert.ok(lauf.ausgabe.includes(`: 1 -> ${wert}`), `${JSON.stringify(wert)}: ${lauf.ausgabe}`);
  }
});

test("Unterdrückungen: ein Pin, der keine Zahl ist, bleibt rot, auch wenn er sich nicht ändert", (context) => {
  const ungueltig = { "src/alt.js": { [KOMPLEXITAET]: "viele" } };
  const lauf = torNachAltlast(context, ungueltig, ungueltig);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/alt\.js -> complexity :: Function 'f'.*: viele -> viele/);
});

test("Unterdrückungen: ein Pin ohne gültige Zahl im alten Stand zählt als 0", (context) => {
  const ungueltig = { "src/alt.js": { [KOMPLEXITAET]: "viele" } };
  const statusMit = (zahl) =>
    torNachAltlast(context, ungueltig, { "src/alt.js": { [KOMPLEXITAET]: zahl } }).status;
  assert.deepEqual([statusMit(0), statusMit(KLEINSTER_ANSTIEG)], [EXIT_GRUEN, EXIT_ROT]);
});

test("Unterdrückungen: vorgemerktes Senken und Streichen in eslint-legacy-exceptions.json ist am Tor grün", (context) => {
  const lauf = torNachAltlast(
    context,
    {
      "src/alt.js": { [KOMPLEXITAET]: 2, [KURZER_NAME]: 1 },
      "src/weg.js": { [KOMPLEXITAET]: 1 },
    },
    { "src/alt.js": { [KOMPLEXITAET]: 1 } },
  );
  assert.equal(lauf.status, EXIT_GRUEN, lauf.ausgabe);
});

test("Unterdrückungen: steigen beide Dateien, nennt das Tor beide", (context) => {
  const repo = repoMitAltlast(context, { "src/alt.js": { [KOMPLEXITAET]: 1 } });
  vormerken(repo, { "src/alt.js": 1 });
  vormerkenAltlast(repo, { "src/alt.js": { [KOMPLEXITAET]: 2 } });
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /in eslint-suppressions\.json steigen Zahlen/);
  assert.match(lauf.ausgabe, /in eslint-legacy-exceptions\.json steigen Zahlen/);
});

test("Unterdrückungen: mit --basis ist ein Branch rot, der einen Pin erhöht, und grün, der nur senkt", (context) => {
  const basis = { "src/alt.js": { [KOMPLEXITAET]: 1, [KURZER_NAME]: 2 } };
  const erhoeht = repoMitAltlast(context, basis);
  writeFiles(erhoeht, { [ALTLAST]: altlast({ "src/alt.js": { [KOMPLEXITAET]: 1, [KURZER_NAME]: 3 } }) });
  commitAll(erhoeht, "erhöht");
  const gesenkt = repoMitAltlast(context, basis);
  writeFiles(gesenkt, { [ALTLAST]: altlast({ "src/alt.js": { [KOMPLEXITAET]: 1 } }) });
  commitAll(gesenkt, "gesenkt");
  const laeufe = [tor(erhoeht, ["--basis", "HEAD~1"]), tor(gesenkt, ["--basis", "HEAD~1"])];
  assert.deepEqual(laeufe.map(({ status }) => status), [EXIT_ROT, EXIT_GRUEN], laeufe.map(({ ausgabe }) => ausgabe).join("\n"));
  assert.match(laeufe[0].ausgabe, /src\/alt\.js -> id-length :: Identifier name 'q'.*: 2 -> 3/);
});

const VERSTOESSE_IN_ALT = 2;

function lintRepo(context, gezaehlt) {
  const { scripts } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const repo = probeRepository(context, {
    "package.json": `${JSON.stringify({ type: "module", scripts: { lint: scripts.lint } })}\n`,
    "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
    "src/alt.js": "var erster = 1;\nvar zweiter = 2;\nexport { erster, zweiter };\n",
    [UNTERDRUECKUNGEN]: `${JSON.stringify({ "src/alt.js": { "no-var": { count: gezaehlt } } })}\n`,
  });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  return runIn(repo, "npm", ["run", "--silent", "lint"]);
}

test("npm run lint bleibt grün, wenn eslint-suppressions.json mehr unterdrückt, als es Verstöße gibt", (context) => {
  const lauf = lintRepo(context, VERSTOESSE_IN_ALT + 1);
  assert.equal(lauf.status, EXIT_GRUEN, `${lauf.stdout}${lauf.stderr}`);
});

test("npm run lint ist rot, wenn eslint-suppressions.json weniger unterdrückt, als es Verstöße gibt", (context) => {
  const lauf = lintRepo(context, VERSTOESSE_IN_ALT - 1);
  assert.equal(lauf.status, EXIT_ROT, `${lauf.stdout}${lauf.stderr}`);
});
