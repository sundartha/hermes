import assert from "node:assert/strict";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const ISSUE = 54;
const LANGE_ZEILEN = 587;
const TYPZEILEN = 40;

const ZAHL_JS = "export function zahl(wert) {\n  return Number(wert);\n}\n";
const ZAHL_TS = "export function zahl(wert: string): number {\n  return Number(wert);\n}\n";
const LAUFZEITZEILE = "export const NEU = 1;\n";
const RECHNEN = 'import { zahl } from "./zahl.js";\n\nexport function summe(links, rechts) {\n  return zahl(links) + zahl(rechts);\n}\n';
const ZAHL_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  "",
  'import { zahl } from "../src/zahl.js";',
  "",
  'test("zahl", () => assert.equal(zahl("2"), 2));',
  "",
].join("\n");
const LANG_JS = ["export function lang(wert) {", "  return wert;", "}", ...Array.from({ length: LANGE_ZEILEN - 3 }, (_leer, index) => `export const wert${index} = ${index};`), ""].join("\n");
const TYPEN = Array.from({ length: TYPZEILEN }, (_leer, index) => `export type Zahl${index} = number;\n`).join("");
const GEMEINSAM = [{ bereich: "gemeinsam", quellen: ["^src/"], eingaenge: [], fachlogik: [] }];

const BEREICHE = [{ bereich: "rechnen", quellen: ["^src/rechnen\\.[jt]s$"], eingaenge: [], fachlogik: [] }, ...GEMEINSAM];

const BASIS = {
  "package.json": JSON.stringify({ type: "module" }),
  "tools/bereiche.json": JSON.stringify(GEMEINSAM),
  "src/zahl.js": ZAHL_JS,
  "src/lang.js": LANG_JS,
  "src/rechnen.js": RECHNEN,
  "test/zahl.test.js": ZAHL_TEST,
};

function umbau(bereich, erwarteteDateien) {
  return { id: "A1", art: "umbau", ziel: "Typisiere die Datei", bereich, erwarteteDateien, vorbild: bereich, abnahme: "test/zahl.test.js" };
}

function vorbereitet(context, auftrag, dateien = {}) {
  const repo = probeRepository(context, { ...BASIS, ...dateien });
  const werkzeug = probeDirectory(context, {});
  const phasendatei = join(werkzeug, "phase.json");
  writeFileSync(phasendatei, JSON.stringify({ phase: "probe", issue: ISSUE, entwurf: { [auftrag.bereich]: "Entwurf." }, auftraege: [auftrag] }));
  return { repo, phasendatei };
}

function umbenannt(probe, { alt, neu, text }) {
  rmSync(join(probe.repo, alt));
  writeFiles(probe.repo, { [neu]: text });
  return probe;
}

function nachziehen(repo) {
  const lauf = runIn(repo, process.execPath, [EINSTIEG, "importendungen", "--basis", "HEAD"]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  return lauf.stdout;
}

function grenzen({ repo, phasendatei }) {
  return runIn(repo, process.execPath, [EINSTIEG, "grenzen", phasendatei, "A1", "--rolle", "bau", "--basis", "HEAD"]);
}

function lies(repo, pfad) {
  return readFileSync(join(repo, pfad), "utf8");
}

function vorgemerkt(repo) {
  return runIn(repo, "git", ["diff", "--cached", "--name-only", "--no-renames"]).stdout;
}

const ZAHL = { alt: "src/zahl.js", neu: "src/zahl.ts", text: ZAHL_TS };
const PAAR_VERSTOSS = /^Verstoß: außerhalb des Bereichs src\/zahl\.js: src\/zahl\.ts; /m;
const ABGELEHNT = /^Hinweis: src\/zahl\.js → src\/zahl\.ts zählt nicht als nur Typen: /m;
const NICHTS_NACHGEZOGEN = /^grün: 0 Dateien auf die neue Endung nachgezogen\.$/m;

function mitVerweis(context, dateien) {
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]), dateien), ZAHL);
  const nachgezogen = nachziehen(probe.repo);
  return { nachgezogen, lauf: grenzen(probe), repo: probe.repo };
}

function gehtDurch(context, dateien) {
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]), dateien), ZAHL);
  assert.match(nachziehen(probe.repo), /^grün: 2 Dateien auf die neue Endung nachgezogen\.$/m);
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
}

function abgelehntHinweis(datei) {
  return `Hinweis: src/zahl.js → src/zahl.ts zählt nicht als nur Typen: ${datei} nennt die alte Datei noch außerhalb eines umschreibbaren Imports`;
}

test("auftrag-umbenennung-grenzen: eine nur-Typen-Umbenennung zieht die Importe nach, merkt sie vor und bleibt in den Grenzen", (context) => {
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"])), ZAHL);
  assert.match(nachziehen(probe.repo), /^src\/rechnen\.js\ntest\/zahl\.test\.js\ngrün: 2 Dateien auf die neue Endung nachgezogen\.$/m);
  assert.match(lies(probe.repo, "src/rechnen.js"), /from "\.\/zahl\.ts";/);
  assert.match(lies(probe.repo, "test/zahl.test.js"), /from "\.\.\/src\/zahl\.ts";/);
  assert.equal(vorgemerkt(probe.repo), "src/rechnen.js\nsrc/zahl.js\nsrc/zahl.ts\ntest/zahl.test.js\n");
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^grün: 4 Dateien geändert, 1 neue Zeilen Produktcode, Rolle bau\.$/m);
});

test("auftrag-umbenennung-grenzen: das Zählen der Zeilen schreibt nichts in die Objektdatenbank", (context) => {
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"])), ZAHL);
  nachziehen(probe.repo);
  const vorher = runIn(probe.repo, "git", ["count-objects", "-v"]).stdout;
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.equal(runIn(probe.repo, "git", ["count-objects", "-v"]).stdout, vorher);
});

test("auftrag-umbenennung-grenzen: der .ts-Zwilling gehört zu einem Dateibereich, eine .mts nicht", (context) => {
  const zwilling = vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]));
  const geprueft = runIn(zwilling.repo, process.execPath, [EINSTIEG, "pruefe", zwilling.phasendatei]);
  assert.equal(geprueft.status, EXIT_GRUEN, geprueft.stdout + geprueft.stderr);
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.mts"])), ZAHL);
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^A1: erwartete Datei src\/zahl\.mts liegt nicht im Bereich$/m);
});

test("auftrag-umbenennung-grenzen: ändert der Bau eine Testdatei über die Endung hinaus, ist das ein Test im Bau", (context) => {
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"])), ZAHL);
  nachziehen(probe.repo);
  writeFiles(probe.repo, { "test/zahl.test.js": `${lies(probe.repo, "test/zahl.test.js")}test("null", () => assert.equal(zahl("0"), 0));\n` });
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, /^Verstoß: Der Bau-Agent hat einen Test geändert: test\/zahl\.test\.js$/m);
  assert.doesNotMatch(lauf.stdout, /src\/rechnen\.js/);
});

test("auftrag-umbenennung-grenzen: ein Paar mit Laufzeitänderung zählt voll, seine Importeure bleiben Verstöße", (context) => {
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"])), { ...ZAHL, text: `${ZAHL_TS}${LAUFZEITZEILE}` });
  assert.match(nachziehen(probe.repo), /^grün: 0 Dateien auf die neue Endung nachgezogen\.$/m);
  writeFiles(probe.repo, {
    "src/rechnen.js": RECHNEN.replace("./zahl.js", "./zahl.ts"),
    "test/zahl.test.js": ZAHL_TEST.replace("../src/zahl.js", "../src/zahl.ts"),
  });
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, /^Verstoß: außerhalb des Bereichs src\/zahl\.js: src\/rechnen\.js; /m);
  assert.match(lauf.stdout, /^Verstoß: außerhalb des Bereichs src\/zahl\.js: src\/zahl\.ts; /m);
  assert.match(lauf.stdout, /^Verstoß: Der Bau-Agent hat einen Test geändert: test\/zahl\.test\.js$/m);
  assert.match(lauf.stdout, /^rot: 4 Dateien geändert, 5 neue Zeilen Produktcode, Rolle bau\.$/m);
});

test("auftrag-umbenennung-grenzen: eine Datei mit 587 Zeilen und 40 Typzeilen zählt 40 Zeilen", (context) => {
  const probe = umbenannt(vorbereitet(context, umbau("src/lang.js", ["src/lang.ts"])), { alt: "src/lang.js", neu: "src/lang.ts", text: `${LANG_JS}${TYPEN}` });
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^grün: 2 Dateien geändert, 40 neue Zeilen Produktcode, Rolle bau\.$/m);
});

test("auftrag-umbenennung-grenzen: ändert ein Umbenennungs-Auftrag zusätzlich eine andere Datei seines Ordners, ist das ein Verstoß", (context) => {
  const probe = umbenannt(vorbereitet(context, umbau("src/", ["src/zahl.ts"])), ZAHL);
  nachziehen(probe.repo);
  writeFiles(probe.repo, { "src/lang.js": `${LANG_JS}export const NOCH = 1;\n` });
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, /^Verstoß: außerhalb des Bereichs src\/: src\/lang\.js; ein Umbenennungs-Auftrag ändert nur seine nur-Typen-Paare/m);
  assert.doesNotMatch(lauf.stdout, /^Verstoß: .*src\/(zahl\.[jt]s|rechnen\.js)/m);
});

test("auftrag-umbenennung-grenzen: benennt ein Umbenennungs-Auftrag eine Datei eines anderen Bereichs um, ist das ein Verstoß", (context) => {
  const rechnen = { alt: "src/rechnen.js", neu: "src/rechnen.ts", text: RECHNEN.replace("summe(links, rechts)", "summe(links: string, rechts: string): number") };
  const probe = umbenannt(vorbereitet(context, umbau("src/", ["src/rechnen.ts"]), { "tools/bereiche.json": JSON.stringify(BEREICHE) }), rechnen);
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, /^Verstoß: außerhalb des Bereichs src\/: src\/rechnen\.ts gehört laut tools\/bereiche\.json zum Bereich rechnen$/m);
  assert.match(lauf.stdout, /^Verstoß: außerhalb des Bereichs src\/: src\/rechnen\.js gehört laut tools\/bereiche\.json zum Bereich rechnen$/m);
});

const NUR_RECHNEN = BEREICHE.filter(({ bereich }) => bereich === "rechnen");

test("auftrag-umbenennung-grenzen: steht die umbenannte Datei in keinem Bereich und liegt im Auftragsbereich, bleibt grenzen grün", (context) => {
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]), { "tools/bereiche.json": JSON.stringify(NUR_RECHNEN) }), ZAHL);
  nachziehen(probe.repo);
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
});

test("auftrag-umbenennung-grenzen: steht die alte Datei in einem Bereich und ihr .ts-Zwilling in keinem, ist das ein Verstoß", (context) => {
  const nurAlteDatei = [{ bereich: "zahl", quellen: ["^src/zahl\\.js$"], eingaenge: [], fachlogik: [] }];
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]), { "tools/bereiche.json": JSON.stringify(nurAlteDatei) }), ZAHL);
  nachziehen(probe.repo);
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, /^Verstoß: außerhalb des Bereichs src\/zahl\.js: src\/zahl\.ts steht in keinem Bereich laut tools\/bereiche\.json$/m);
  assert.doesNotMatch(lauf.stdout, /^Verstoß: .*: src\/zahl\.js /m);
});

test("auftrag-umbenennung-grenzen: eine geschützte Datei bleibt geschützt, auch wenn nur ihre Importendung nachgezogen ist", (context) => {
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]), { ".github/CODEOWNERS": "/src/rechnen.js @probe\n" }), ZAHL);
  nachziehen(probe.repo);
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, /^Verstoß: geschützte Datei geändert: src\/rechnen\.js$/m);
});

test("auftrag-umbenennung-grenzen: zeigt noch new URL auf die alte Datei, ist das Paar geändert und nichts wird nachgezogen", (context) => {
  const { nachgezogen, lauf } = mitVerweis(context, { "src/pfad.js": 'export const ZAHL = new URL("./zahl.js", import.meta.url);\n' });
  assert.match(nachgezogen, NICHTS_NACHGEZOGEN);
  assert.ok(nachgezogen.includes(abgelehntHinweis("src/pfad.js")), nachgezogen);
  assert.match(lauf.stdout, ABGELEHNT);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, PAAR_VERSTOSS);
});

test("auftrag-umbenennung-grenzen: bewacht existsSync mit einem Template die alte Datei, ist das Paar geändert", (context) => {
  const { nachgezogen, lauf } = mitVerweis(context, { "src/waechter.js": 'import { existsSync } from "node:fs";\n\nexport const DA = existsSync(`src/zahl.js`);\n' });
  assert.match(nachgezogen, NICHTS_NACHGEZOGEN);
  assert.ok(nachgezogen.includes(abgelehntHinweis("src/waechter.js")), nachgezogen);
  assert.match(lauf.stdout, ABGELEHNT);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, PAAR_VERSTOSS);
});

test("auftrag-umbenennung-grenzen: ruft ein Skript in package.json die alte Datei auf, ist das Paar geändert", (context) => {
  const { nachgezogen, lauf } = mitVerweis(context, { "package.json": JSON.stringify({ type: "module", scripts: { zahl: "node src/zahl.js" } }) });
  assert.match(nachgezogen, NICHTS_NACHGEZOGEN);
  assert.ok(nachgezogen.includes(abgelehntHinweis("package.json")), nachgezogen);
  assert.match(lauf.stdout, ABGELEHNT);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, PAAR_VERSTOSS);
});

test("auftrag-umbenennung-grenzen: ersetzt mock.module die alte Datei, ist das Paar geändert", (context) => {
  const attrappe = 'import { mock, test } from "node:test";\n\ntest("attrappe", () => mock.module("../src/zahl.js", { namedExports: {} }));\n';
  const { nachgezogen, lauf } = mitVerweis(context, { "test/attrappe.test.js": attrappe });
  assert.match(nachgezogen, NICHTS_NACHGEZOGEN);
  assert.ok(nachgezogen.includes(abgelehntHinweis("test/attrappe.test.js")), nachgezogen);
  assert.match(lauf.stdout, ABGELEHNT);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, PAAR_VERSTOSS);
});

test("auftrag-umbenennung-grenzen: nennt eine Konfigurationsdatei im Wurzelordner die alte Datei, ist das Paar geändert", (context) => {
  const { nachgezogen, lauf } = mitVerweis(context, { "probe.config.js": 'export default [{ files: ["src/zahl.js"] }];\n' });
  assert.match(nachgezogen, NICHTS_NACHGEZOGEN);
  assert.ok(nachgezogen.includes(abgelehntHinweis("probe.config.js")), nachgezogen);
  assert.match(lauf.stdout, ABGELEHNT);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, PAAR_VERSTOSS);
});

const REGLER = "export class Regler {\n  constructor(private wert: number) {}\n}\n";
const REGLER_MIT_IMPORT = 'import { zahl } from "./zahl.js";\n\nexport class Regler {\n  constructor(private wert: string) {}\n\n  zahl() {\n    return zahl(this.wert);\n  }\n}\n';

function bleibtGeaendert({ nachgezogen, lauf }, hinweis) {
  assert.match(nachgezogen, NICHTS_NACHGEZOGEN);
  assert.ok(nachgezogen.includes(hinweis), nachgezogen);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, ABGELEHNT);
  assert.match(lauf.stdout, PAAR_VERSTOSS);
}

test("auftrag-umbenennung-grenzen: eine TypeScript-Datei mit Parameter-Property in apps/ hält eine nur-Typen-Umbenennung nicht auf", (context) => {
  gehtDurch(context, { "apps/lab/src/regler.ts": REGLER });
});

test("auftrag-umbenennung-grenzen: eine Datei mit Parameter-Property, die die alte Datei importiert, wird nicht umgeschrieben, das Paar ist geändert", (context) => {
  const ergebnis = mitVerweis(context, { "src/regler.ts": REGLER_MIT_IMPORT });
  assert.equal(lies(ergebnis.repo, "src/regler.ts"), REGLER_MIT_IMPORT);
  bleibtGeaendert(ergebnis, abgelehntHinweis("src/regler.ts"));
});

test("auftrag-umbenennung-grenzen: eine Datei, die sich nicht lesen lässt, hält das Paar auf und steht mit Namen im Hinweis", (context) => {
  bleibtGeaendert(
    mitVerweis(context, { "src/kaputt.js": "export const = ;\n" }),
    "Hinweis: src/zahl.js → src/zahl.ts zählt nicht als nur Typen: src/kaputt.js lässt sich nicht lesen, ein Verweis auf die alte Datei ist nicht auszuschließen",
  );
});

test("auftrag-umbenennung-grenzen: nennt knip.json die alte Datei als Einstieg, ist das Paar geändert", (context) => {
  bleibtGeaendert(mitVerweis(context, { "knip.json": JSON.stringify({ entry: ["src/zahl.js"] }) }), abgelehntHinweis("knip.json"));
});

test("auftrag-umbenennung-grenzen: steht die alte Datei als Schlüssel in einer JSON-Datei, ist das Paar geändert", (context) => {
  const zuordnung = JSON.stringify({ "src/zahl.js": { "no-console": { count: 1 } } });
  bleibtGeaendert(mitVerweis(context, { "tools/zuordnung.json": zuordnung }), abgelehntHinweis("tools/zuordnung.json"));
});

test("auftrag-umbenennung-grenzen: nennt eine JSON-Datei die alte Datei relativ zu sich, ist das Paar geändert", (context) => {
  bleibtGeaendert(mitVerweis(context, { "src/tsconfig.json": JSON.stringify({ files: ["./zahl.js"] }) }), abgelehntHinweis("src/tsconfig.json"));
});

test("auftrag-umbenennung-grenzen: ruft ein Workflow die alte Datei auf, ist das Paar geändert", (context) => {
  const workflow = "jobs:\n  probe:\n    steps:\n      - run: node src/zahl.js\n";
  bleibtGeaendert(mitVerweis(context, { ".github/workflows/probe.yml": workflow }), abgelehntHinweis(".github/workflows/probe.yml"));
});

test("auftrag-umbenennung-grenzen: nennt nur ein Markdown-Dokument die alte Datei, hält das die Umbenennung nicht auf", (context) => {
  gehtDurch(context, { "docs/zahl.md": "Siehe `src/zahl.js`.\n" });
});

const PHASE_MIT_ALTER = JSON.stringify({ phase: "P-900-probe", auftraege: [{ id: "A1", art: "umbau", bereich: "src/zahl.js" }] });

test("auftrag-umbenennung-grenzen: nennt nur eine Phasendatei unter plaene/ die alte Datei, hält das die Umbenennung nicht auf", (context) => {
  gehtDurch(context, { "plaene/P-900-probe/phase.json": PHASE_MIT_ALTER });
});

test("auftrag-umbenennung-grenzen: nennt eine JSON-Datei unter plaene/…/planung/ die alte Datei, hält das die Umbenennung nicht auf", (context) => {
  gehtDurch(context, { "plaene/P-900-probe/planung/auftraege.json": JSON.stringify({ text: "Umbau von src/zahl.js" }) });
});

const AEHNLICH_ABER_VERWEIS = [
  ["plaene/P-900-probe/skript.js", 'export const PFAD = "src/zahl.js";\n'],
  ["plaene/P-900-probe/notiz.txt", "src/zahl.js\n"],
  ["docs/plaene/phase.json", PHASE_MIT_ALTER],
  ["plaene-alt/phase.json", PHASE_MIT_ALTER],
];

for (const [datei, text] of AEHNLICH_ABER_VERWEIS) {
  test(`auftrag-umbenennung-grenzen: nennt ${datei} die alte Datei, ist das Paar geändert`, (context) => {
    bleibtGeaendert(mitVerweis(context, { [datei]: text }), abgelehntHinweis(datei));
  });
}

test("auftrag-umbenennung-grenzen: nennen eine Phasendatei und knip.json die alte Datei, ist das Paar wegen knip.json geändert", (context) => {
  const dateien = { "plaene/P-900-probe/phase.json": PHASE_MIT_ALTER, "knip.json": JSON.stringify({ entry: ["src/zahl.js"] }) };
  bleibtGeaendert(mitVerweis(context, dateien), abgelehntHinweis("knip.json"));
});

test("auftrag-umbenennung-grenzen: ein Import mit Escape in der Quelle wird nicht umgeschrieben, das Paar ist geändert", (context) => {
  const mitEscape = RECHNEN.replace('"./zahl.js"', '"./zahl.js\\\n"');
  const { nachgezogen, lauf } = mitVerweis(context, { "src/rechnen.js": mitEscape });
  assert.match(nachgezogen, NICHTS_NACHGEZOGEN);
  assert.ok(nachgezogen.includes(abgelehntHinweis("src/rechnen.js")), nachgezogen);
  assert.match(lauf.stdout, ABGELEHNT);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, PAAR_VERSTOSS);
});

test("auftrag-umbenennung-grenzen: ein Import mit Escape bleibt beim Nachziehen Zeichen für Zeichen stehen", (context) => {
  const mitEscape = RECHNEN.replace('"./zahl.js"', '"./zahl.js\\\n"');
  const probe = umbenannt(vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]), { "src/rechnen.js": mitEscape }), ZAHL);
  nachziehen(probe.repo);
  assert.equal(lies(probe.repo, "src/rechnen.js"), mitEscape);
});

test("auftrag-umbenennung-grenzen: ein .ts-Zwilling als Symlink ist kein nur-Typen-Paar", (context) => {
  const probe = vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]));
  const ziel = join(probeDirectory(context, { "zahl.ts": ZAHL_TS }), "zahl.ts");
  rmSync(join(probe.repo, "src/zahl.js"));
  symlinkSync(ziel, join(probe.repo, "src/zahl.ts"));
  assert.match(nachziehen(probe.repo), NICHTS_NACHGEZOGEN);
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, /^Hinweis: src\/zahl\.js → src\/zahl\.ts zählt nicht als nur Typen: der \.ts-Zwilling ist ein Symlink$/m);
  assert.match(lauf.stdout, PAAR_VERSTOSS);
});

test("auftrag-umbenennung-grenzen: fehlt tools/bereiche.json, bricht grenzen einen Umbenennungs-Auftrag mit Grund ab", (context) => {
  const probe = vorbereitet(context, umbau("src/zahl.js", ["src/zahl.ts"]));
  rmSync(join(probe.repo, "tools/bereiche.json"));
  commitAll(probe.repo, "ohne Bereichsliste");
  umbenannt(probe, ZAHL);
  nachziehen(probe.repo);
  const lauf = grenzen(probe);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^Abbruch: tools\/bereiche\.json fehlt; /m);
});
