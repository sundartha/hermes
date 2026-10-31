import assert from "node:assert/strict";
import { cpSync, realpathSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { KRITISCH_OHNE_GATE_TEST } from "../../tools/auftrag/agenten.mjs";
import { SCHUTZ, gitSchutzLage, schutzGrund } from "../../tools/ziele/schutz.mjs";
import { vorhandenerPfad } from "../../tools/zwillingspfad.mjs";
import { ESLINT_BIN, REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const DEPCRUISE_BIN = join(REPO_ROOT, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");
const MITGENOMMEN = ["package.json", "tsconfig.json", "eslint.config.js", ".dependency-cruiser.cjs", "tools"];
const EXIT_OK = 0;
const KRITISCH_ABFRAGE = "kritisch-abfrage.mjs";
const KRITISCH_ABFRAGE_TEXT = [
  'import { argv } from "node:process";',
  'import { istKritisch } from "./tools/auftrag/agenten.mjs";',
  "console.log(JSON.stringify(argv.slice(2).map(istKritisch)));",
  "",
].join("\n");
const STIMME = "src/routes/voice";
const BELEGABRUF = "src/telephony/adapters/telnyx/voice";
const LLM_NAHT = "src/llm/adapters/anthropic";
const BELEGABRUF_TEXT = 'export const BELEGE = "/v2/detail_records";\n';
const LLM_NAHT_TEXT = 'export const leer = (fehler) => fehler.message.includes("credit");\n';
const PFAD_REGELN = new Set(["hermes/wort-nur-in", "hermes/keine-steuerung-ueber-meldung"]);
const AUSFALL = "src/telephony/outage-report";
const AUSFALL_REGEL = "server-baut-ausfall-meldung";
const WEITERE_PFLICHTMODULE = [
  "billing/paid-without-number-watch.js",
  "billing/price-drift-watch.js",
  "billing/provision-retry-sweep.js",
  "telephony/ani-ownership-recheck.js",
];
const LEERES_MODUL = "export const da = true;\n";
const LISTEN_ABFRAGE = "listen-abfrage.mjs";
const LISTEN_ABFRAGE_TEXT = [
  'import fs from "node:fs";',
  'import { syncBuiltinESMExports } from "node:module";',
  'import { argv } from "node:process";',
  "const gesehen = [];",
  'for (const name of ["existsSync", "statSync", "lstatSync", "accessSync", "readFileSync", "readdirSync"]) {',
  "  const echt = fs[name];",
  "  fs[name] = (pfad, ...rest) => {",
  "    gesehen.push(String(pfad));",
  "    return echt(pfad, ...rest);",
  "  };",
  "}",
  "syncBuiltinESMExports();",
  'const { KRITISCH_OHNE_GATE_TEST: liste, istKritisch } = await import("./tools/auftrag/agenten.mjs");',
  "const nachImport = gesehen.filter((pfad) => pfad.includes('/src/')).length;",
  "const flach = [liste].flat();",
  "const iteration = [];",
  "for (const eintrag of liste) iteration.push(eintrag);",
  "const kritisch = argv.slice(2).map(istKritisch);",
  "const nachLesen = gesehen.filter((pfad) => pfad.includes('/src/')).length;",
  "console.log(JSON.stringify({ nachImport, nachLesen, flach, iteration, laenge: liste.length, ist: Array.isArray(liste), kritisch }));",
  "",
].join("\n");

const GESPRAECH = "src/conversation/elevenlabs-agent-config";
const SCHUTZLISTEN = {
  "tools/ziele/geschuetzt.json": `${JSON.stringify({ gates: "tools/gate-tests.json", gespraech: [`${GESPRAECH}.js`] })}\n`,
  "tools/gate-tests.json": "{}\n",
};

function geschuetztGrund(context, dateien, pfad) {
  return schutzGrund(pfad, gitSchutzLage(probeDirectory(context, { ...SCHUTZLISTEN, ...dateien })));
}

function wurzelMit(context, dateien) {
  return pathToFileURL(`${probeDirectory(context, dateien)}/`);
}

function probeMitWerkzeugen(context, dateien) {
  const wurzel = probeDirectory(context, dateien);
  for (const eintrag of MITGENOMMEN) {
    cpSync(join(REPO_ROOT, eintrag), join(wurzel, eintrag), { recursive: true });
  }
  symlinkSync(join(REPO_ROOT, "node_modules"), join(wurzel, "node_modules"));
  return wurzel;
}

function kritisch(context, dateien, pfade) {
  const wurzel = probeMitWerkzeugen(context, { ...dateien, [KRITISCH_ABFRAGE]: KRITISCH_ABFRAGE_TEXT });
  const lauf = runIn(wurzel, process.execPath, [KRITISCH_ABFRAGE, ...pfade]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  return JSON.parse(lauf.stdout);
}

function pfadRegelFunde(context, dateien) {
  const wurzel = probeMitWerkzeugen(context, dateien);
  const ziele = Object.keys(dateien).filter((datei) => datei.endsWith(".ts"));
  const lauf = runIn(wurzel, process.execPath, [ESLINT_BIN, "--format", "json", ...ziele]);
  assert.ok(lauf.stdout.startsWith("["), lauf.stderr);
  return JSON.parse(lauf.stdout).flatMap(({ filePath, messages }) =>
    messages
      .filter(({ ruleId }) => PFAD_REGELN.has(ruleId))
      .map(({ ruleId }) => `${relative(realpathSync(wurzel), filePath)} ${ruleId}`),
  );
}

function pflichtVerstoesse(context, ausfallDateien, ausfallImport) {
  const weitere = Object.fromEntries(WEITERE_PFLICHTMODULE.map((modul) => [`src/${modul}`, LEERES_MODUL]));
  const importe = [ausfallImport, ...WEITERE_PFLICHTMODULE.map((modul) => `./${modul}`)];
  const wurzel = probeMitWerkzeugen(context, {
    ...ausfallDateien,
    ...weitere,
    "src/server.js": importe.map((quelle) => `import "${quelle}";\n`).join(""),
  });
  const config = ["--config", ".dependency-cruiser.cjs", "--output-type", "baseline"];
  const lauf = runIn(wurzel, process.execPath, [DEPCRUISE_BIN, "src", ...config]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  return JSON.parse(lauf.stdout)
    .map(({ rule }) => rule.name)
    .filter((name) => name.startsWith("server-baut-"));
}

test("agenten: die nach .ts umbenannte kritische Datei bleibt kritisch", (context) => {
  assert.deepEqual(kritisch(context, { [`${STIMME}.ts`]: LEERES_MODUL }, [`${STIMME}.ts`]), [true]);
});

test("agenten: eine fremde .ts-Datei mit ähnlichem Namen wird nicht kritisch", (context) => {
  assert.deepEqual(kritisch(context, { [`${STIMME}2.ts`]: LEERES_MODUL }, [`${STIMME}2.ts`]), [false]);
});

test("agenten: fehlen beide Endungen, bleibt der .js-Eintrag stehen und der Zwilling zählt nicht", (context) => {
  assert.deepEqual(kritisch(context, {}, [`${STIMME}.js`, `${STIMME}.ts`]), [true, false]);
});

test("eslint: die nach .ts umbenannten Ausnahmen von wort-nur-in und Steuerung gelten weiter", (context) => {
  const funde = pfadRegelFunde(context, {
    [`${BELEGABRUF}.ts`]: BELEGABRUF_TEXT,
    [`${LLM_NAHT}.ts`]: LLM_NAHT_TEXT,
  });
  assert.deepEqual(funde, []);
});

test("eslint: fremde .ts-Dateien mit ähnlichem Namen bekommen keine Ausnahme", (context) => {
  const funde = pfadRegelFunde(context, {
    [`${BELEGABRUF}2.ts`]: BELEGABRUF_TEXT,
    [`${LLM_NAHT}2.ts`]: LLM_NAHT_TEXT,
  });
  assert.deepEqual(funde.toSorted(), [
    `${LLM_NAHT}2.ts hermes/keine-steuerung-ueber-meldung`,
    `${BELEGABRUF}2.ts hermes/wort-nur-in`,
  ]);
});

test("eslint: neben der vorhandenen .js-Datei bekommt ihr .ts-Zwilling keine Ausnahme", (context) => {
  const funde = pfadRegelFunde(context, {
    [`${BELEGABRUF}.js`]: BELEGABRUF_TEXT,
    [`${BELEGABRUF}.ts`]: BELEGABRUF_TEXT,
  });
  assert.deepEqual(funde, [`${BELEGABRUF}.ts hermes/wort-nur-in`]);
});

test("dependency-cruiser: der Import des nach .ts umbenannten Pflichtmoduls erfüllt die Pflichtregel", (context) => {
  const verstoesse = pflichtVerstoesse(context, { [`${AUSFALL}.ts`]: LEERES_MODUL }, "./telephony/outage-report.ts");
  assert.deepEqual(verstoesse, []);
});

test("dependency-cruiser: eine fremde .ts-Datei erfüllt die Pflichtregel nicht, die fehlende Datei bleibt rot", (context) => {
  const verstoesse = pflichtVerstoesse(context, { [`${AUSFALL}2.ts`]: LEERES_MODUL }, "./telephony/outage-report2.ts");
  assert.deepEqual(verstoesse, [AUSFALL_REGEL]);
});

test("dependency-cruiser: neben der vorhandenen .js-Datei erfüllt der Import des Zwillings die Pflichtregel nicht", (context) => {
  const dateien = { [`${AUSFALL}.js`]: LEERES_MODUL, [`${AUSFALL}.ts`]: LEERES_MODUL };
  assert.deepEqual(pflichtVerstoesse(context, dateien, "./telephony/outage-report.ts"), [AUSFALL_REGEL]);
});

test("vorhandenerPfad nennt den .ts-Zwilling nur, wenn die .js-Datei fehlt und der Zwilling da ist", (context) => {
  const wurzel = wurzelMit(context, { [`${STIMME}.ts`]: LEERES_MODUL });
  assert.equal(vorhandenerPfad(`${STIMME}.js`, wurzel), `${STIMME}.ts`);
});

test("vorhandenerPfad trifft keine fremde .ts-Datei mit ähnlichem Namen", (context) => {
  const wurzel = wurzelMit(context, { [`${STIMME}2.ts`]: LEERES_MODUL, [`${STIMME}.d.ts`]: LEERES_MODUL });
  assert.equal(vorhandenerPfad(`${STIMME}.js`, wurzel), `${STIMME}.js`);
});

test("vorhandenerPfad lässt die .js-Datei stehen, wenn sie da ist, auch neben einem Zwilling", (context) => {
  const wurzel = wurzelMit(context, { [`${STIMME}.js`]: LEERES_MODUL, [`${STIMME}.ts`]: LEERES_MODUL });
  assert.equal(vorhandenerPfad(`${STIMME}.js`, wurzel), `${STIMME}.js`);
});

test("vorhandenerPfad lässt einen fehlenden Pfad, Ordner, Präfixe und andere Endungen unverändert", (context) => {
  const wurzel = wurzelMit(context, {
    "src/billing/a.ts": LEERES_MODUL,
    "src/routes/webhooks-a.ts": LEERES_MODUL,
    "tools/b.mts": LEERES_MODUL,
  });
  assert.equal(vorhandenerPfad("src/fehlt.js", wurzel), "src/fehlt.js");
  assert.equal(vorhandenerPfad("src/billing/", wurzel), "src/billing/");
  assert.equal(vorhandenerPfad("src/routes/webhooks-", wurzel), "src/routes/webhooks-");
  assert.equal(vorhandenerPfad("src/billing/a.ts", wurzel), "src/billing/a.ts");
  assert.equal(vorhandenerPfad("tools/b.mjs", wurzel), "tools/b.mjs");
});

test("ziele: die nach .ts umbenannte Datei der Schutzliste bleibt geschützt", (context) => {
  const grund = geschuetztGrund(context, { [`${GESPRAECH}.ts`]: LEERES_MODUL }, `${GESPRAECH}.ts`);
  assert.equal(grund, SCHUTZ.importgraph);
});

test("ziele: eine fremde .ts-Datei mit ähnlichem Namen wird durch die Schutzliste nicht geschützt", (context) => {
  assert.equal(geschuetztGrund(context, { [`${GESPRAECH}2.ts`]: LEERES_MODUL }, `${GESPRAECH}2.ts`), null);
});

test("ziele: neben der vorhandenen .js-Datei der Schutzliste wird ihr .ts-Zwilling nicht geschützt", (context) => {
  const dateien = { [`${GESPRAECH}.js`]: LEERES_MODUL, [`${GESPRAECH}.ts`]: LEERES_MODUL };
  assert.equal(geschuetztGrund(context, dateien, `${GESPRAECH}.js`), SCHUTZ.importgraph);
  assert.equal(geschuetztGrund(context, dateien, `${GESPRAECH}.ts`), null);
});

function listenAbfrage(context, dateien, pfade) {
  const wurzel = probeMitWerkzeugen(context, { ...dateien, [LISTEN_ABFRAGE]: LISTEN_ABFRAGE_TEXT });
  const lauf = runIn(wurzel, process.execPath, [LISTEN_ABFRAGE, ...pfade]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  return { wurzel, ...JSON.parse(lauf.stdout) };
}

function ersterJsEintrag() {
  const eintrag = [...KRITISCH_OHNE_GATE_TEST].find((pfad) => pfad.endsWith(".js"));
  assert.ok(eintrag, "kein .js-Eintrag mehr in KRITISCH_OHNE_GATE_TEST");
  return eintrag;
}

test("agenten: der bloße Import liest nichts unter src/, erst das Lesen der Liste prüft die Pfade", (context) => {
  const abfrage = listenAbfrage(context, {}, []);
  assert.equal(abfrage.nachImport, 0);
  assert.ok(abfrage.nachLesen > 0);
});

test("agenten: flat, Iteration und length der Liste zeigen den aufgelösten Zwilling, kritisch ist nur er", (context) => {
  const js = ersterJsEintrag();
  const ts = js.replace(/\.js$/, ".ts");
  const abfrage = listenAbfrage(context, { [ts]: LEERES_MODUL }, [ts, js]);
  const erwartet = [...KRITISCH_OHNE_GATE_TEST].map((pfad) => (pfad === js ? ts : pfad));
  assert.deepEqual(abfrage.flach, erwartet);
  assert.deepEqual(abfrage.iteration, erwartet);
  assert.equal(abfrage.laenge, erwartet.length);
  assert.equal(abfrage.ist, true);
  assert.deepEqual(abfrage.kritisch, [true, false]);
});
