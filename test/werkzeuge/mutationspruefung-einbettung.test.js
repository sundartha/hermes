import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, EXIT_ROT, pruefe, schluessel, UEBERLEBT } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

const EXIT_OK = 0;
const EXIT_ABBRUCH = 2;
const MUTANTEN = /^src\/zahl\.js: ([1-9]\d*) Mutanten gegen \d+ Testdateien/m;
const ERSTLAUF_ROT = /^Abbruch: Erstlauf rot: /m;
const UEBERLEBENDE_ZEILE_DREI = /^src\/zahl\.js:3[ :]/;

const SKRIPT_ENDE = ['export const SKRIPT = ["\\"use strict\\";", einordnen.toString(), ""].join("\\n");', ""];
const EINORDNEN_BASIS = ["export function einordnen(zahl) {", '  if (zahl < 0) return "negativ";', '  return "positiv";', "}"];
const EINORDNEN_NEU = ["export function einordnen(zahl) {", '  if (zahl < 0) return "negativ";', '  if (zahl === 0) return "null";', '  return "positiv";', "}"];
const OHNE_EXPORT = EINORDNEN_NEU.map((zeile) => zeile.replace(/^export /, ""));
const ERWARTETER_TEXT = ['"use strict";', ...OHNE_EXPORT, ""].join("\n");

function quelle(...zeilen) {
  return [...zeilen, ...SKRIPT_ENDE].join("\n");
}

function skripttest(...pruefungen) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { runInNewContext } from "node:vm";',
    'import { SKRIPT } from "../src/zahl.js";',
    "const ausfuehren = (zahl) => runInNewContext(`${SKRIPT}\\neinordnen(${zahl});`);",
    'test("das eingebettete Skript ordnet Zahlen ein", () => {',
    ...pruefungen,
    "});",
    "",
  ].join("\n");
}

const FALL_NEGATIV = '  assert.equal(ausfuehren(-1), "negativ");';
const FALL_NULL = '  assert.equal(ausfuehren(0), "null");';
const FALL_POSITIV = '  assert.equal(ausfuehren(1), "positiv");';
const SKRIPT_GENAU = `  assert.equal(SKRIPT, ${JSON.stringify(ERWARTETER_TEXT)});`;

function eingebettet(context, { neu = quelle(...EINORDNEN_NEU), testtext }) {
  const repo = probeRepository(context, {
    ...BASIS,
    "src/zahl.js": quelle(...EINORDNEN_BASIS),
    "test/zahl.test.js": testtext,
  });
  writeFiles(repo, { "src/zahl.js": neu });
  return repo;
}

function ueberlebende(lauf) {
  return schluessel(lauf.stdout, UEBERLEBT);
}

function mutantenzahl(lauf) {
  return Number(MUTANTEN.exec(lauf.stdout)?.[1] ?? 0);
}

function erwarteAlleGetoetet(lauf) {
  assert.doesNotMatch(lauf.stdout + lauf.stderr, ERSTLAUF_ROT);
  assert.ok(mutantenzahl(lauf) > 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(ueberlebende(lauf), [], lauf.stdout);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
}

test("Eine Funktion, die per toString() in ein Skript eingebettet und im vm-Kontext ausgeführt wird, wird mit echten Mutanten geprüft, und die Tests töten sie", (context) => {
  const repo = eingebettet(context, { testtext: skripttest(FALL_NEGATIV, FALL_NULL, FALL_POSITIV) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  erwarteAlleGetoetet(lauf);
});

test("Positivkontrolle: prüft der Test die geänderte Zeile nicht, überlebt ihr Mutant im Skript und die Prüfung wird rot", (context) => {
  const repo = eingebettet(context, { testtext: skripttest(FALL_NEGATIV, FALL_POSITIV) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.doesNotMatch(lauf.stdout + lauf.stderr, ERSTLAUF_ROT);
  const offen = ueberlebende(lauf);
  assert.ok(offen.length > 0, lauf.stdout + lauf.stderr);
  assert.ok(
    offen.every((mutant) => UEBERLEBENDE_ZEILE_DREI.test(mutant)),
    offen.join("\n"),
  );
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
});

test("Ein Test, der den ausgelieferten Skripttext Byte für Byte festhält, besteht den Erstlauf auf dem echten Text und tötet jeden Mutanten der Funktion", (context) => {
  const repo = eingebettet(context, { testtext: skripttest(SKRIPT_GENAU) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  erwarteAlleGetoetet(lauf);
});

test("Eine eingebettete Funktion, deren Name im Original zweimal vorkommt, bricht den Erstlauf laut mit der Meldung mehrdeutig ab, statt einen Text zu raten", (context) => {
  const nachbar = ["export function nachbar() {", "  function einordnen() {}", "  return einordnen;", "}"];
  const repo = eingebettet(context, {
    neu: quelle(...EINORDNEN_NEU, ...nachbar),
    testtext: skripttest(FALL_NEGATIV, FALL_NULL, FALL_POSITIV),
  });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.match(lauf.stdout + lauf.stderr, /Einbettung: .*einordnen.* mehrdeutig/);
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
});

test("Eine eingebettete Funktion, die im Original keine Funktionsdeklaration ist, bricht den Erstlauf laut ab, statt unaufgelöste Mutanten-Aufrufe auszuliefern", (context) => {
  const ausdruck = [
    "export const einordnen = function (zahl) {",
    '  if (zahl < 0) return "negativ";',
    '  if (zahl === 0) return "null";',
    '  return "positiv";',
    "};",
  ];
  const repo = eingebettet(context, {
    neu: quelle(...ausdruck),
    testtext: skripttest(FALL_NEGATIV, FALL_NULL, FALL_POSITIV),
  });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.match(lauf.stdout + lauf.stderr, /Einbettung: .*einordnen.* keine Funktionsdeklaration/);
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
});

const FENSTER_BASIS = [
  "export function isObject(wert) {",
  '  return typeof wert === "object" && wert !== null;',
  "}",
  "export function behandle(fenster, nachricht) {",
  "  if (!isObject(nachricht)) return false;",
  '  if (nachricht.methode === "ergebnis" && isObject(nachricht.daten)) {',
  "    fenster.feld.textContent = String(nachricht.daten.status);",
  "    return true;",
  "  }",
  "  return false;",
  "}",
  "export function starte(fenster) {",
  '  fenster.addEventListener("message", (ereignis) => behandle(fenster, ereignis && ereignis.data));',
  "}",
  "export const SKRIPT = [",
  '  "\\"use strict\\";",',
  "  isObject.toString(),",
  "  behandle.toString(),",
  "  starte.toString(),",
  '  "starte(window);",',
  '].join("\\n");',
  "",
].join("\n");
const FENSTER_NEU = FENSTER_BASIS.replace(
  'if (nachricht.methode === "ergebnis" && isObject(nachricht.daten)) {',
  'if (isObject(nachricht.daten) && nachricht.methode === "ergebnis") {',
);

const FENSTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { runInNewContext } from "node:vm";',
  'import { SKRIPT } from "../src/zahl.js";',
  "function seite(nachricht) {",
  "  const abonnenten = [];",
  '  const feld = { textContent: "" };',
  "  const fenster = { feld, addEventListener: (art, behandlung) => abonnenten.push([art, behandlung]) };",
  "  fenster.window = fenster;",
  "  runInNewContext(SKRIPT, fenster);",
  '  for (const [art, behandlung] of abonnenten) if (art === "message") behandlung(nachricht);',
  "  return feld.textContent;",
  "}",
  'test("das Skript im Fenster übernimmt nur Ergebnisse mit Daten", () => {',
  '  assert.equal(seite({ data: { methode: "ergebnis", daten: { status: "dialing" } } }), "dialing");',
  '  assert.equal(seite({ data: { methode: "ergebnis", daten: "dialing" } }), "");',
  '  assert.equal(seite({ data: { methode: "ergebnis", daten: null } }), "");',
  '  assert.equal(seite({ data: { methode: "anderes", daten: { status: "dialing" } } }), "");',
  '  assert.equal(seite({ data: "ergebnis" }), "");',
  '  assert.equal(seite({ data: null }), "");',
  '  assert.equal(seite(undefined), "");',
  "});",
  "",
].join("\n");

const FENSTER_BLIND = [
  'import { test } from "node:test";',
  'import "../src/zahl.js";',
  'test("lädt", () => {});',
  "",
].join("\n");

function fensterRepo(context, testtext) {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": FENSTER_BASIS, "test/zahl.test.js": testtext });
  writeFiles(repo, { "src/zahl.js": FENSTER_NEU });
  return repo;
}

test("Mehrere eingebettete Funktionen, die sich gegenseitig aufrufen und über run(window) im vm-Kontext laufen, wie in widget-bind.js, werden mit echten Mutanten geprüft: der Test des Skripts tötet sie, ohne ihn überlebt jeder", (context) => {
  const lauf = pruefe(fensterRepo(context, FENSTER_TEST), "--basis", "HEAD");
  erwarteAlleGetoetet(lauf);

  const blind = pruefe(fensterRepo(context, FENSTER_BLIND), "--basis", "HEAD");
  assert.doesNotMatch(blind.stdout + blind.stderr, ERSTLAUF_ROT);
  assert.ok(mutantenzahl(blind) > 0, blind.stdout + blind.stderr);
  assert.equal(ueberlebende(blind).length, mutantenzahl(blind), blind.stdout);
  assert.equal(blind.status, EXIT_ROT, blind.stdout + blind.stderr);
});
