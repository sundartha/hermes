import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { LISTENUMZUG, umzugGemerkt, umzugZuruecknehmen } from "../../tools/auftrag/listenumzug.mjs";

import { REPO_ROOT, commitAll, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const AUSFUEHRBAR = 0o755;
const ALT = "teil.js";
const NEU = "teil.ts";
const SEMGREP_BASIS = "tools/basis/semgrep.json";
const UNTERDRUECKUNGEN = "eslint-suppressions.json";

const TEIL_JS = "export function teil(wert) {\n  return wert + 1;\n}\n\nexport const lauf = (befehl) => exec(befehl);\n";
const TEIL_TS = TEIL_JS.replace("teil(wert)", "teil(wert: number): number");
const TEIL_TS_IN_DER_ZEILE = TEIL_TS.replace("(befehl) =>", "(befehl: string) =>");
const TEIL_MIT_LAUFZEIT = TEIL_TS.replace("wert + 1", "wert + 2");

const ERSATZ_SEMGREP = `#!/usr/bin/env node
const { readFileSync, readdirSync } = require("node:fs");
if (process.argv.includes("--version")) return console.log("9.9.9");
function treffer(pfad) {
  let anfang = 0;
  return readFileSync(pfad, "utf8").split("\\n").flatMap((zeile, index) => {
    const start = anfang;
    anfang += zeile.length + 1;
    return zeile.includes("exec(") ? [{ check_id: "probe.zeile", path: pfad, start: { line: index + 1, offset: start }, end: { offset: start + zeile.length } }] : [];
  });
}
console.log(JSON.stringify({ errors: [], results: readdirSync("src").flatMap((name) => treffer("src/" + name)) }));
`;

const REGEL = { severity: "error", name: "probe-regel" };
const TEST_IMPORTE = `[
  {
    "type": "dependency",
    "from": "test/teil.test.js",
    "to": "src/teil.js",
    "unresolvedTo": "../src/teil.js",
    "dependencyTypes": ["local", "import"],
    "rule": { "severity": "error", "name": "tests-nur-ueber-eingaenge" }
  },
  {
    "type": "dependency",
    "from": "test/rest.test.js",
    "to": "src/rest.js",
    "unresolvedTo": "../src/rest.js",
    "dependencyTypes": ["local", "import"],
    "rule": { "severity": "error", "name": "tests-nur-ueber-eingaenge" }
  }
]
`;
const GATES = `{
  "Probe": {
    "module": ["src/teil.js", "src/teil.js#lauf", "src/rest.js"],
    "tests": ["test/teil.test.js", "test/rest.test.js"]
  }
}
`;
const LISTEN = {
  [UNTERDRUECKUNGEN]: JSON.stringify({ "src/rest.js": { complexity: { count: 1 } }, "src/teil.js": { "id-length": { count: 2 } } }, null, 2),
  "eslint-legacy-exceptions.json": `${JSON.stringify({ "src/teil.js": { reason: "Probe", rules: { complexity: 12 } }, "src/rest.js": { reason: "Probe", rules: { complexity: 11 } } }, null, 2)}\n`,
  ".dependency-cruiser-known-violations.json": `${JSON.stringify(
    [
      { type: "dependency", from: "src/teil.js", to: "src/rest.js", unresolvedTo: "./rest.js", rule: REGEL },
      { type: "dependency", from: "src/rest.js", to: "src/teil.js", unresolvedTo: "./teil.js", rule: REGEL },
    ],
    null,
    2,
  )}\n`,
  "tools/basis/test-importe.json": TEST_IMPORTE,
  "tools/basis/knip.json": `${JSON.stringify({ befunde: ["exports|src/rest.js|rest", "exports|src/teil.js|lauf", "files|src/teil.js|src/teil.js"] }, null, 2)}\n`,
  "tools/gate-tests.json": GATES,
};
const LISTENPFADE = [...Object.keys(LISTEN), SEMGREP_BASIS];
const BASIS = {
  "package.json": JSON.stringify({ type: "module" }),
  "src/teil.js": TEIL_JS,
  "src/rest.js": "export const rest = (befehl) => exec(befehl);\n",
  "tools/basis/semgrep-regeln.json": "{}\n",
  ...LISTEN,
};

function umgebung(werkzeuge) {
  return { ...isolatedEnvironment(), PATH: `${werkzeuge}${delimiter}${process.env.PATH}` };
}

function starte(probe, skript, argumente) {
  const lauf = spawnSync(process.execPath, [skript, ...argumente], { cwd: probe.repo, encoding: "utf8", env: probe.umgebung });
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

function angelegt(probe, werkzeug) {
  const lauf = starte(probe, BASIS_VERGLEICH, [werkzeug, "--basis-anlegen"]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.ausgabe);
}

function vorbereitet(context, zusatz = {}) {
  const werkzeuge = probeDirectory(context, { semgrep: ERSATZ_SEMGREP });
  chmodSync(join(werkzeuge, "semgrep"), AUSFUEHRBAR);
  const probe = { repo: probeRepository(context, { ...BASIS, ...zusatz }), umgebung: umgebung(werkzeuge), werkzeuge };
  angelegt(probe, "semgrep");
  commitAll(probe.repo, "Basislinie");
  probe.vorher = Object.fromEntries(LISTENPFADE.map((pfad) => [pfad, lies(probe, pfad)]));
  return probe;
}

function lies({ repo }, pfad) {
  return readFileSync(join(repo, pfad), "utf8");
}

function umbenannt(probe, inhalt) {
  rmSync(join(probe.repo, `src/${ALT}`));
  writeFileSync(join(probe.repo, `src/${NEU}`), inhalt);
  return probe;
}

function umgezogen(probe) {
  const lauf = starte(probe, LISTENUMZUG, ["--basis", "HEAD"]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.ausgabe);
  return lauf.ausgabe;
}

function eintraege(wert) {
  if (Array.isArray(wert)) return wert.reduce((summe, eintrag) => summe + 1 + eintraege(eintrag), 0);
  if (wert === null || typeof wert !== "object") return 0;
  return Object.values(wert).reduce((summe, eintrag) => summe + 1 + eintraege(eintrag), 0);
}

function werteMit(wert, teil) {
  if (typeof wert === "string") return wert.includes(teil) ? [wert] : [];
  if (wert === null || typeof wert !== "object") return [];
  return Object.entries(wert).flatMap(([schluessel, eintrag]) => [...werteMit(schluessel, teil), ...werteMit(eintrag, teil)]);
}

test("auftrag-listenumzug: eine nur-Typen-Umbenennung zieht die Einträge der alten Datei in allen sieben Listen auf die neue um und lässt die Form der Datei stehen", (context) => {
  const probe = umbenannt(vorbereitet(context), TEIL_TS);
  umgezogen(probe);
  for (const pfad of LISTENPFADE) assert.equal(lies(probe, pfad), probe.vorher[pfad].replaceAll(ALT, NEU), pfad);
  const statisch = starte(probe, BASIS_VERGLEICH, ["semgrep", "--basis", "HEAD"]);
  assert.equal(statisch.status, EXIT_GRUEN, statisch.ausgabe);
});

test("auftrag-listenumzug: nach dem Umzug hat jede Liste gleich viele Einträge wie vorher", (context) => {
  const probe = umbenannt(vorbereitet(context), TEIL_TS);
  umgezogen(probe);
  for (const pfad of LISTENPFADE) assert.equal(eintraege(JSON.parse(lies(probe, pfad))), eintraege(JSON.parse(probe.vorher[pfad])), pfad);
});

test("auftrag-listenumzug: Einträge einer anderen Datei bleiben unverändert", (context) => {
  const probe = umbenannt(vorbereitet(context), TEIL_TS);
  umgezogen(probe);
  for (const pfad of LISTENPFADE) assert.deepEqual(werteMit(JSON.parse(lies(probe, pfad)), "rest."), werteMit(JSON.parse(probe.vorher[pfad]), "rest."), pfad);
});

test("auftrag-listenumzug: bei einer Umbenennung mit Laufzeitänderung ändert sich keine Liste", (context) => {
  const probe = umbenannt(vorbereitet(context), TEIL_MIT_LAUFZEIT);
  umgezogen(probe);
  for (const pfad of LISTENPFADE) assert.equal(lies(probe, pfad), probe.vorher[pfad], pfad);
});

test("auftrag-listenumzug: nennt eine andere Datei die alte noch, zählt das Paar wie für grenzen bau nicht als nur Typen, und keine Liste ändert sich", (context) => {
  const probe = umbenannt(vorbereitet(context, { "src/verweis.js": `export const PFAD = "src/${ALT}";\n` }), TEIL_TS);
  assert.match(umgezogen(probe), /src\/verweis\.js nennt die alte Datei/);
  for (const pfad of LISTENPFADE) assert.equal(lies(probe, pfad), probe.vorher[pfad], pfad);
});

test("auftrag-listenumzug: nennt eine Datei außerhalb der sieben Listen die alte noch, zählt das Paar nicht als nur Typen, und keine Liste ändert sich", (context) => {
  const probe = umbenannt(vorbereitet(context, { "knip.json": `${JSON.stringify({ ignore: [`src/${ALT}`] }, null, 2)}\n` }), TEIL_TS);
  assert.match(umgezogen(probe), /knip\.json nennt die alte Datei/);
  for (const pfad of LISTENPFADE) assert.equal(lies(probe, pfad), probe.vorher[pfad], pfad);
});

test("auftrag-listenumzug: ändern die Typen die Semgrep-Fundstelle, zählt das Paar nicht als nur Typen, keine Liste ändert sich, und die Prüfung meldet den Befund", (context) => {
  const probe = umbenannt(vorbereitet(context), TEIL_TS_IN_DER_ZEILE);
  assert.match(umgezogen(probe), /tools\/basis\/semgrep\.json nennt die alte Datei in einem Eintrag, den der Listenumzug nicht umschreibt$/m);
  for (const pfad of LISTENPFADE) assert.equal(lies(probe, pfad), probe.vorher[pfad], pfad);
  const statisch = starte(probe, BASIS_VERGLEICH, ["semgrep", "--basis", "HEAD"]);
  assert.equal(statisch.status, EXIT_ROT, statisch.ausgabe);
  assert.match(statisch.ausgabe, /src\/teil\.ts:5 probe\.zeile/);
});

test("auftrag-listenumzug: der Lauf nimmt vor der Wiederholung nur den eigenen Umzug zurück, eine spätere Änderung an einer Liste bleibt", (context) => {
  const probe = umbenannt(vorbereitet(context), TEIL_TS);
  const { gruen, umzug } = umzugGemerkt(probe.repo, () => starte(probe, LISTENUMZUG, ["--basis", "HEAD"]).status === EXIT_GRUEN);
  assert.ok(gruen);
  const fremd = `${lies(probe, UNTERDRUECKUNGEN)}\n`;
  writeFileSync(join(probe.repo, UNTERDRUECKUNGEN), fremd);
  umzugZuruecknehmen(probe.repo, umzug);
  assert.equal(lies(probe, UNTERDRUECKUNGEN), fremd);
  for (const pfad of LISTENPFADE.filter((eintrag) => eintrag !== UNTERDRUECKUNGEN)) assert.equal(lies(probe, pfad), probe.vorher[pfad], pfad);
});

test("auftrag-listenumzug: nimmt der Lauf den eigenen Umzug zurück, steht auch im Index wieder die Liste von vorher", (context) => {
  const probe = umbenannt(vorbereitet(context), TEIL_TS);
  const { umzug } = umzugGemerkt(probe.repo, () => starte(probe, LISTENUMZUG, ["--basis", "HEAD"]).status === EXIT_GRUEN);
  umzugZuruecknehmen(probe.repo, umzug);
  for (const pfad of LISTENPFADE) assert.equal(runIn(probe.repo, "git", ["show", `:${pfad}`]).stdout, probe.vorher[pfad], pfad);
});

function bleibtJedeListe(probe, ...muster) {
  const ausgabe = umgezogen(probe);
  for (const zeile of muster) assert.match(ausgabe, zeile);
  for (const pfad of LISTENPFADE) assert.equal(lies(probe, pfad), probe.vorher[pfad], pfad);
}

test("auftrag-listenumzug: läuft semgrep nicht, bleibt der Semgrep-Eintrag, das Paar zählt nicht als nur Typen, und keine Liste ändert sich", (context) => {
  const probe = umbenannt(vorbereitet(context), TEIL_TS);
  writeFileSync(join(probe.werkzeuge, "semgrep"), "#!/usr/bin/env node\nprocess.exitCode = 2;\n");
  bleibtJedeListe(probe, /tools\/basis\/semgrep\.json nennt die alte Datei in einem Eintrag, den der Listenumzug nicht umschreibt: semgrep lief nicht/);
});

test("auftrag-listenumzug: lässt sich eine Liste im Text nicht eindeutig ersetzen, bleibt sie, das Paar zählt nicht als nur Typen, und keine Liste ändert sich", (context) => {
  const doppelt = '{\n  "src/teil.js": { "id-length": { "count": 1 } },\n  "src/teil.js": { "complexity": { "count": 2 } }\n}\n';
  const probe = umbenannt(vorbereitet(context, { [UNTERDRUECKUNGEN]: doppelt }), TEIL_TS);
  bleibtJedeListe(probe, /eslint-suppressions\.json nennt die alte Datei in einem Eintrag, den der Listenumzug nicht umschreibt: die Einträge ließen sich im Text nicht eindeutig ersetzen/);
});

test("auftrag-listenumzug: steht die neue Datei schon als Schlüssel in einer Liste, bleibt der alte Schlüssel, das Paar zählt nicht als nur Typen, und keine Liste ändert sich", (context) => {
  const beide = JSON.stringify({ "src/teil.js": { "id-length": { count: 2 } }, [`src/${NEU}`]: { complexity: { count: 1 } } }, null, 2);
  const probe = umbenannt(vorbereitet(context, { [UNTERDRUECKUNGEN]: beide }), TEIL_TS);
  bleibtJedeListe(probe, /eslint-suppressions\.json nennt die alte Datei in einem Eintrag, den der Listenumzug nicht umschreibt$/m);
});

const BEREICH = "tools/auftrag/vorbereitung-bereich.json";

function mitBereich(context, eintraege) {
  const probe = vorbereitet(context, { [BEREICH]: `${JSON.stringify(eintraege, null, 2)}\n` });
  probe.vorher[BEREICH] = lies(probe, BEREICH);
  return probe;
}

function bereich(probe) {
  return JSON.parse(lies(probe, BEREICH));
}

test("auftrag-listenumzug: eine nur-Typen-Umbenennung zieht den Eintrag der Bereichsliste auf die neue Datei, die Anzahl bleibt, andere Einträge bleiben", (context) => {
  const probe = umbenannt(mitBereich(context, ["src/rest.js", `src/${ALT}`, "src/zuletzt.js"]), TEIL_TS);
  assert.match(umgezogen(probe), /tools\/auftrag\/vorbereitung-bereich\.json: 1 Pfade auf die neue Datei umgezogen\./);
  assert.equal(lies(probe, BEREICH), probe.vorher[BEREICH].replace(ALT, NEU));
  assert.deepEqual(bereich(probe), ["src/rest.js", `src/${NEU}`, "src/zuletzt.js"]);
});

test("auftrag-listenumzug: bei einer Umbenennung mit Laufzeitänderung bleibt die Bereichsliste", (context) => {
  const probe = umbenannt(mitBereich(context, ["src/rest.js", `src/${ALT}`]), TEIL_MIT_LAUFZEIT);
  umgezogen(probe);
  assert.equal(lies(probe, BEREICH), probe.vorher[BEREICH]);
});

test("auftrag-listenumzug: gerät die Bereichsliste durch den Umzug aus der Ordnung, steht sie danach sortiert und ohne Doppel da", (context) => {
  const probe = umbenannt(mitBereich(context, ["src/rest.js", `src/${ALT}`, "src/teil.m.js"]), TEIL_TS);
  assert.match(umgezogen(probe), /tools\/auftrag\/vorbereitung-bereich\.json: 1 Pfade auf die neue Datei umgezogen\./);
  assert.deepEqual(bereich(probe), ["src/rest.js", "src/teil.m.js", `src/${NEU}`]);
});

test("auftrag-listenumzug: steht die neue Datei schon in der Bereichsliste, bleibt der alte Eintrag, das Paar zählt nicht als nur Typen, und keine Liste ändert sich", (context) => {
  const probe = umbenannt(mitBereich(context, [`src/${ALT}`, `src/${NEU}`]), TEIL_TS);
  bleibtJedeListe(probe, /tools\/auftrag\/vorbereitung-bereich\.json nennt die alte Datei in einem Eintrag, den der Listenumzug nicht umschreibt$/m);
  assert.equal(lies(probe, BEREICH), probe.vorher[BEREICH]);
});
