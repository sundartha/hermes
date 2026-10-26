import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { LISTEN_KUERZEN } from "../../tools/auftrag/listen-kuerzen.mjs";

import { isolatedEnvironment, probeRepository, runIn } from "./probe-repo.js";

const EXIT_GRUEN = 0;
const BEREICHE = "tools/bereiche.json";
const KNIP = "tools/basis/knip.json";
const ANWEISUNGEN = "tools/basis/anweisungen.json";
const JSCPD = "tools/basis/jscpd.json";
const SELBSTPRUEFUNG = "tools/basis/selbstpruefung.json";
const TEST_IMPORTE = "tools/basis/test-importe.json";
const GATES = "tools/gate-tests.json";

const TOTES_MUSTER = String.raw`      "^src/[^/]+/ports\\.[jt]s$",
`;
const BEREICHE_TEXT = String.raw`[
  {
    "bereich": "probe",
    "quellen": ["^src/"],
    "eingaenge": [
      "^src/x/rest\\.[jt]s$",
${TOTES_MUSTER.trimEnd()}
      "^src/nie\\.js$",
      "^src/(mail/ports|x/rest)\\.[jt]s$"
    ]
  }
]
`;
const KNIP_TEXT = `{
  "befunde": [
    "exports|src/x/rest.js|rest",
    "files|src/alt/weg.js|src/alt/weg.js",
    "files|src/mail/ports.js|src/mail/ports.js"
  ]
}
`;
const ANWEISUNGEN_TEXT = `{
  "befunde": [
    "CLAUDE.md|0062f66239a2b3c1",
    "src/alt|ohne-eigene-regeln",
    "src/mail|ohne-eigene-regeln",
    "src/x|ohne-eigene-regeln"
  ]
}
`;
const JSCPD_TEXT = `{
  "version": "5.0.14",
  "befunde": [
    "src/mail/ports.js|src/x/rest.js|5",
    "src/x/rest.js|src/x/rest.js|3"
  ]
}
`;
const SELBSTPRUEFUNG_TEXT = `{
  "befunde": [
    "test/alt.test.js|bb59f7d5e94acc03",
    "test/mail.test.js|487c7fc0811791bb"
  ]
}
`;
const IMPORT_MAIL = `  {
    "type": "dependency",
    "from": "test/mail.test.js",
    "to": "src/mail/ports.js",
    "unresolvedTo": "../src/mail/ports.js",
    "dependencyTypes": ["local", "import"],
    "rule": {
      "severity": "error",
      "name": "tests-nur-ueber-eingaenge"
    }
  },
`;
const TEST_IMPORTE_TEXT = `[
${IMPORT_MAIL}  {
    "type": "dependency",
    "from": "test/x.test.js",
    "to": "src/x/rest.js",
    "unresolvedTo": "../src/x/rest.js",
    "dependencyTypes": ["local", "import"],
    "rule": {
      "severity": "error",
      "name": "tests-nur-ueber-eingaenge"
    }
  }
]
`;
const GATES_TEXT = `${JSON.stringify({ Probe: { module: ["src/mail/ports.js", "src/x/rest.js"], tests: ["test/mail.test.js", "test/x.test.js"] } }, null, 2)}\n`;

const LISTEN = {
  [BEREICHE]: BEREICHE_TEXT,
  [KNIP]: KNIP_TEXT,
  [ANWEISUNGEN]: ANWEISUNGEN_TEXT,
  [JSCPD]: JSCPD_TEXT,
  [SELBSTPRUEFUNG]: SELBSTPRUEFUNG_TEXT,
  [TEST_IMPORTE]: TEST_IMPORTE_TEXT,
  [GATES]: GATES_TEXT,
};
const BASIS = {
  "package.json": JSON.stringify({ type: "module" }),
  "src/mail/ports.js": "export {};\n",
  "src/x/rest.js": "export const rest = 1;\n",
  "test/mail.test.js": "export const probe = 1;\n",
  "test/x.test.js": "export const probe = 2;\n",
  ...LISTEN,
};
const GELOESCHT = ["src/mail/ports.js", "test/mail.test.js"];

function vorbereitet(context, zusatz = {}) {
  return probeRepository(context, { ...BASIS, ...zusatz });
}

function geloescht(repo, pfade = GELOESCHT) {
  runIn(repo, "git", ["rm", "-q", ...pfade]);
  return repo;
}

function gekuerzt(repo) {
  const lauf = spawnSync(process.execPath, [LISTEN_KUERZEN, "--basis", "HEAD"], { cwd: repo, encoding: "utf8", env: isolatedEnvironment() });
  const ausgabe = `${lauf.stdout}${lauf.stderr}`;
  assert.equal(lauf.status, EXIT_GRUEN, ausgabe);
  return ausgabe;
}

function lies(repo, pfad) {
  return readFileSync(join(repo, pfad), "utf8");
}

function anzahl(text) {
  const wert = JSON.parse(text);
  return Array.isArray(wert) ? wert.length : wert.befunde.length;
}

test("auftrag-listen-kuerzen: ein Muster in tools/bereiche.json, das an der Basis nur die gelöschte Datei traf, fällt, der übrige Text bleibt bytegleich", (context) => {
  const repo = geloescht(vorbereitet(context));
  gekuerzt(repo);
  assert.equal(lies(repo, BEREICHE), BEREICHE_TEXT.replace(TOTES_MUSTER, ""));
});

test("auftrag-listen-kuerzen: ein Muster, das noch eine Datei trifft, an der Basis schon nichts traf oder nur eine tote Alternative hat, bleibt", (context) => {
  const repo = geloescht(vorbereitet(context));
  gekuerzt(repo);
  const [{ quellen, eingaenge }] = JSON.parse(lies(repo, BEREICHE));
  assert.deepEqual(quellen, ["^src/"]);
  assert.deepEqual(eingaenge, [String.raw`^src/x/rest\.[jt]s$`, String.raw`^src/nie\.js$`, String.raw`^src/(mail/ports|x/rest)\.[jt]s$`]);
});

test("auftrag-listen-kuerzen: der knip-Eintrag der gelöschten Datei fällt, der schon an der Basis behobene fremde Eintrag bleibt, und das JSON ist gültig", (context) => {
  const repo = geloescht(vorbereitet(context));
  gekuerzt(repo);
  assert.equal(lies(repo, KNIP), KNIP_TEXT.replace(',\n    "files|src/mail/ports.js|src/mail/ports.js"', ""));
  assert.deepEqual(JSON.parse(lies(repo, KNIP)).befunde, ["exports|src/x/rest.js|rest", "files|src/alt/weg.js|src/alt/weg.js"]);
});

test("auftrag-listen-kuerzen: der anweisungen-Eintrag des verschwundenen Ordners fällt, ein Ordner mit übrigen Dateien und fremde Einträge bleiben", (context) => {
  const repo = geloescht(vorbereitet(context));
  gekuerzt(repo);
  assert.equal(lies(repo, ANWEISUNGEN), ANWEISUNGEN_TEXT.replace('    "src/mail|ohne-eigene-regeln",\n', ""));
});

test("auftrag-listen-kuerzen: in jscpd, selbstpruefung und test-importe fallen nur die Einträge der gelöschten Dateien, Version und andere Felder bleiben", (context) => {
  const repo = geloescht(vorbereitet(context));
  gekuerzt(repo);
  assert.equal(lies(repo, JSCPD), JSCPD_TEXT.replace('    "src/mail/ports.js|src/x/rest.js|5",\n', ""));
  assert.equal(lies(repo, SELBSTPRUEFUNG), SELBSTPRUEFUNG_TEXT.replace(',\n    "test/mail.test.js|487c7fc0811791bb"', ""));
  assert.equal(lies(repo, TEST_IMPORTE), TEST_IMPORTE_TEXT.replace(IMPORT_MAIL, ""));
});

test("auftrag-listen-kuerzen: keine Liste wird länger, und tools/gate-tests.json mit gelöschtem Test bleibt unverändert", (context) => {
  const repo = geloescht(vorbereitet(context));
  gekuerzt(repo);
  for (const [pfad, text] of Object.entries(LISTEN).filter(([liste]) => liste !== GATES)) assert.ok(anzahl(lies(repo, pfad)) <= anzahl(text), pfad);
  assert.equal(lies(repo, GATES), GATES_TEXT);
});

test("auftrag-listen-kuerzen: die Ausgabe nennt jeden gestrichenen Eintrag mit seiner Liste", (context) => {
  const ausgabe = gekuerzt(geloescht(vorbereitet(context)));
  assert.ok(ausgabe.includes(`${BEREICHE}: gestrichen ${JSON.stringify(String.raw`^src/[^/]+/ports\.[jt]s$`)}`), ausgabe);
  assert.ok(ausgabe.includes(`${KNIP}: gestrichen "files|src/mail/ports.js|src/mail/ports.js"`), ausgabe);
  assert.ok(ausgabe.includes(`${ANWEISUNGEN}: gestrichen "src/mail|ohne-eigene-regeln"`), ausgabe);
});

test("auftrag-listen-kuerzen: ohne Löschung ändert sich keine Liste, auch nicht für schon an der Basis behobene Einträge", (context) => {
  const repo = vorbereitet(context);
  gekuerzt(repo);
  for (const [pfad, text] of Object.entries(LISTEN)) assert.equal(lies(repo, pfad), text, pfad);
});

test("auftrag-listen-kuerzen: lässt sich ein toter Eintrag nicht zeilenweise streichen, bleibt die Liste, und die Ausgabe meldet es", (context) => {
  const einzeilig = `[{ "bereich": "probe", "eingaenge": [${JSON.stringify(String.raw`^src/[^/]+/ports\.[jt]s$`)}, "^src/x/"] }]\n`;
  const repo = geloescht(vorbereitet(context, { [BEREICHE]: einzeilig }));
  const ausgabe = gekuerzt(repo);
  assert.equal(lies(repo, BEREICHE), einzeilig);
  assert.match(ausgabe, /tools\/bereiche\.json: .*nicht zeilenweise streichen, die Liste bleibt/);
});
