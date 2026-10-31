import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REGELN } from "../../tools/vorbereitung/normalform.mjs";
import { AUSLAGERUNG, UMBENENNUNG, vergleicheVorbereitung } from "../../tools/vorbereitung-pruefen.mjs";
import { nachCommitAufrufen, nachCommitPruefen, repoMitBasis } from "./pr-probe.js";
import { REPO_ROOT, commitAll, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/vorbereitung-pruefen.mjs");
const KATALOG = JSON.parse(readFileSync(join(REPO_ROOT, "tools/vorbereitung/katalog.json"), "utf8"));
const BEREICH = JSON.parse(readFileSync(join(REPO_ROOT, "tools/auftrag/vorbereitung-bereich.json"), "utf8"));
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const PFAD = "src/probe.js";
const HILFE = ["export function ist(w) {", '  return typeof w === "string" && w !== "";', "}"];

function quelle(...zeilen) {
  return `${zeilen.join("\n")}\n`;
}

async function vergleich(vorher, nachher) {
  return vergleicheVorbereitung({ pfad: PFAD, vorher, nachher });
}

const GLEICHWERTIG = [
  ["vorlage-string", quelle("const N = 18;", "export const t = () => `n=${N}`;"), quelle("const N = 18;", "export const t = () => `n=${String(N)}`;")],
  ["vorlage-string", quelle("export const t = (a, b) => `n=${a - b}`;"), quelle("export const t = (a, b) => `n=${String(a - b)}`;")],
  ["boolean-verknuepfung", quelle("export const f = (r, fp) => Boolean(r?.a) && r.b === fp;"), quelle("export const f = (r, fp) => (r?.a ? r.b === fp : false);")],
  ["boolean-verknuepfung", quelle("export const f = (r, b) => !!r || b;"), quelle("export const f = (r, b) => (r ? true : b);")],
  ["laenge-optional", quelle("export const f = (p, g) => !p || !p.length || g(p);"), quelle("export const f = (p, g) => !p?.length || g(p);")],
  ["laenge-optional", quelle("export const h = (p) => p;", "export const f = (p, g) => !p || !p.length || g(p);"), quelle("export const h = (p) => p;", "export const f = (p, g) => !p?.length || g(p);")],
  [
    "hilfe-einsetzen",
    quelle(...HILFE, "export function g(u) {", "  if (!ist(u)) return null;", "  return u;", "}"),
    quelle(...HILFE, "export function g(u) {", '  if (!(typeof u === "string" && u !== "")) return null;', "  return u;", "}"),
  ],
  [
    "hilfe-einsetzen",
    quelle(...HILFE, "export function g(a = 1) {", '  var u = "x";', "  return ist(u) && a;", "}"),
    quelle(...HILFE, "export function g(a = 1) {", '  var u = "x";', '  return typeof u === "string" && u !== "" && a;', "}"),
  ],
];

const NICHT_GLEICHWERTIG = [
  ["|| wird ??", quelle("export const f = (a, d) => a || d;"), quelle("export const f = (a, d) => a ?? d;")],
  ["Katalog-Umformung und eine geänderte Zahl", quelle("const N = 18;", "export const t = () => `n=${N}`;"), quelle("const N = 19;", "export const t = () => `n=${String(N)}`;")],
  ["String um einen Wert, der ein Symbol sein kann", quelle("export const t = (w) => `n=${w.x}`;"), quelle("export const t = (w) => `n=${String(w.x)}`;")],
  ["String in einem getaggten Template", quelle("export const t = (n) => tag`n=${n - 1}`;"), quelle("export const t = (n) => tag`n=${String(n - 1)}`;")],
  ["String ist in der Datei gebunden", quelle("const String = (x) => x;", "export const t = (n) => `n=${n - 1}`;"), quelle("const String = (x) => x;", "export const t = (n) => `n=${String(n - 1)}`;")],
  ["Boolean ohne Bedingungsausdruck weggelassen", quelle("export const f = (r, fp) => Boolean(r?.a) && r.b === fp;"), quelle("export const f = (r, fp) => r?.a && r.b === fp;")],
  ["andere Eigenschaft als length", quelle("export const f = (p, g) => !p || !p.size || g(p);"), quelle("export const f = (p, g) => !p?.size || g(p);")],
  ["Argument der Hilfe wird zugewiesen", quelle(...HILFE, "export function g(u) {", "  u = u.trim();", "  return ist(u);", "}"), quelle(...HILFE, "export function g(u) {", "  u = u.trim();", '  return typeof u === "string" && u !== "";', "}")],
  ["Name ist nur in einer anderen Funktion gebunden, hier global", quelle("export const h = (p) => p;", "export const f = (g) => !p || !p.length || g;"), quelle("export const h = (p) => p;", "export const f = (g) => !p?.length || g;")],
  ["Argument der Hilfe ist hier global", quelle(...HILFE, "export const h = (u) => u;", "export const g = () => ist(u);"), quelle(...HILFE, "export const h = (u) => u;", 'export const g = () => typeof u === "string" && u !== "";')],
  ["eval in der Datei", quelle(...HILFE, "export const g = (u) => ist(u) && eval(u);"), quelle(...HILFE, 'export const g = (u) => typeof u === "string" && u !== "" && eval(u);')],
  ["privates Feld #length", quelle("export class K {", "  #length = 0;", "  f(p) {", "    return !p || !p.#length;", "  }", "}"), quelle("export class K {", "  #length = 0;", "  f(p) {", "    return !p?.#length;", "  }", "}")],
  ["Hilfe liest den Parameter nur bedingt", quelle("export function f(p) {", "  return false && p;", "}", "export const g = (y) => f(y);"), quelle("export function f(p) {", "  return false && p;", "}", "export const g = (y) => false && y;")],
  ["String wird in der Datei zugewiesen", quelle("export const t = (n) => `n=${n - 1}`;", "export const s = () => { globalThis.x = 1; };", "String = undefined;"), quelle("export const t = (n) => `n=${String(n - 1)}`;", "export const s = () => { globalThis.x = 1; };", "String = undefined;")],
  ["var im static-Block, hier global", quelle("export class K {", "  static {", "    var p;", "  }", "}", "export const f = (g) => !p || !p.length || g;"), quelle("export class K {", "  static {", "    var p;", "  }", "}", "export const f = (g) => !p?.length || g;")],
  ["var im Rumpf, Hilfe im Standardwert eines Parameters", quelle(...HILFE, "export function g(a = ist(u)) {", "  var u;", "  return a;", "}"), quelle(...HILFE, 'export function g(a = typeof u === "string" && u !== "") {', "  var u;", "  return a;", "}")],
  ["var im Rumpf, length im Standardwert eines Parameters", quelle("export function f(a = !p || !p.length) {", "  var p;", "  return a;", "}"), quelle("export function f(a = !p?.length) {", "  var p;", "  return a;", "}")],
  ["var im Rumpf, Hilfe in einem destrukturierten Parameter", quelle(...HILFE, "export function g({ a = ist(u) }) {", "  var u;", "  return a;", "}"), quelle(...HILFE, 'export function g({ a = typeof u === "string" && u !== "" }) {', "  var u;", "  return a;", "}")],
  ["Boolean ist in der Datei gebunden", quelle("const Boolean = (x) => x;", "export const f = (r, fp) => Boolean(r?.a) && r.b === fp;"), quelle("const Boolean = (x) => x;", "export const f = (r, fp) => (r?.a ? r.b === fp : false);")],
  ["Boolean wird in der Datei zugewiesen", quelle("export const f = (r, fp) => Boolean(r?.a) && r.b === fp;", "Boolean = String;"), quelle("export const f = (r, fp) => (r?.a ? r.b === fp : false);", "Boolean = String;")],
  ["Hilfe ist zweimal gebunden", quelle(...HILFE, "export const g = (u) => {", "  const ist = (w) => w;", "  return ist(u);", "};"), quelle(...HILFE, "export const g = (u) => {", "  const ist = (w) => w;", '  return typeof u === "string" && u !== "";', "};")],
  ["Hilfe wird zugewiesen", quelle(...HILFE, "export const s = () => {", "  ist = Boolean;", "};", "export const g = (u) => ist(u);"), quelle(...HILFE, "export const s = () => {", "  ist = Boolean;", "};", 'export const g = (u) => typeof u === "string" && u !== "";')],
  ["async-Hilfe", quelle("export async function ist(w) {", "  return w === 1;", "}", "export const g = (u) => ist(u);"), quelle("export async function ist(w) {", "  return w === 1;", "}", "export const g = (u) => u === 1;")],
  ["Hilfe mit ==", quelle("export function ist(w) {", "  return w == 1;", "}", "export const g = (u) => ist(u);"), quelle("export function ist(w) {", "  return w == 1;", "}", "export const g = (u) => u == 1;")],
  ["Hilfe liest length", quelle("export function ist(w) {", "  return w !== null && w.length;", "}", "export const g = (u) => ist(u);"), quelle("export function ist(w) {", "  return w !== null && w.length;", "}", "export const g = (u) => u !== null && u.length;")],
  ["Index wird charAt", quelle('const A = "abc";', "export const f = (i) => A[i];"), quelle('const A = "abc";', "export const f = (i) => A.charAt(i);")],
];

test("vorbereitung-pruefen: der Katalog beschreibt genau die Regeln der Normalform, jede mit Begründung", () => {
  assert.deepEqual(KATALOG.umformungen.map(({ id }) => id).toSorted(), Object.keys(REGELN).toSorted());
  for (const eintrag of KATALOG.umformungen) {
    for (const feld of ["vorher", "nachher", "bedingung", "grund"]) assert.ok(eintrag[feld]?.trim(), `${eintrag.id}.${feld}`);
  }
});

test("vorbereitung-pruefen: jede Katalog-Umformung ist grün und nennt ihre Regel", async () => {
  for (const [id, vorher, nachher] of GLEICHWERTIG) {
    assert.deepEqual(await vergleich(vorher, nachher), { gleich: true, genutzt: [id] }, id);
  }
});

test("vorbereitung-pruefen: Änderungen außerhalb des Katalogs sind rot und nennen die Zeile", async () => {
  for (const [fall, vorher, nachher] of NICHT_GLEICHWERTIG) {
    const ergebnis = await vergleich(vorher, nachher);
    assert.equal(ergebnis.gleich, false, fall);
    assert.match(ergebnis.befund, /^src\/probe\.js:\d+: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/, fall);
  }
});

test("vorbereitung-pruefen: nur Kommentare geändert ist grün ohne Regel", async () => {
  assert.deepEqual(await vergleich(quelle("export const f = 1;"), quelle("// eins", "export const f = 1;")), { gleich: true, genutzt: [] });
});

test("vorbereitung-pruefen: eine nicht lesbare Datei ist rot", async () => {
  assert.deepEqual(await vergleich(quelle("export const f = 1;"), quelle("export const f = ;")), { gleich: false, befund: `${PFAD}: nicht lesbar` });
});

test("vorbereitung-pruefen: über Git rot bei ?? mit Zweck, grün bei Katalog-Umformung", (context) => {
  const [, vorher, nachher] = GLEICHWERTIG[0];
  const repo = repoMitBasis(context, { [PFAD]: vorher, "src/b.js": quelle("export const f = (a, d) => a || d;") });
  const gruen = nachCommitPruefen(repo, WERKZEUG, { [PFAD]: nachher });
  assert.equal(gruen.status, EXIT_GRUEN, gruen.output);
  assert.match(gruen.output, /^src\/probe\.js: gleichwertig \(vorlage-string\)$/m);
  const rot = nachCommitPruefen(repo, WERKZEUG, { "src/b.js": quelle("export const f = (a, d) => a ?? d;") });
  assert.equal(rot.status, EXIT_ROT, rot.output);
  assert.match(rot.output, /^src\/b\.js:1: Änderung, die keine Umformung/m);
  assert.match(rot.output, /tools\/vorbereitung\/katalog\.json/);
});

test("vorbereitung-pruefen: neue JavaScript-Datei ist rot, nur-Typen-Umbenennung zählt nicht", (context) => {
  const repo = repoMitBasis(context, { "src/a.js": quelle("export const a = (x) => x + 1;") });
  const neu = nachCommitPruefen(repo, WERKZEUG, { "src/neu.js": quelle("export const n = 1;") });
  assert.equal(neu.status, EXIT_ROT, neu.output);
  assert.match(neu.output, /^src\/neu\.js: neu; das ist keine Umformung aus dem Katalog$/m);
  runIn(repo.directory, "git", ["rm", "-q", "src/neu.js", "src/a.js"]);
  writeFiles(repo.directory, { "src/a.ts": quelle("export const a = (x: number): number => x + 1;") });
  commitAll(repo.directory, "Umbenennung");
  const lauf = runIn(repo.directory, process.execPath, [WERKZEUG, "--basis", repo.basis]);
  assert.equal(lauf.status, EXIT_GRUEN, `${lauf.stdout}${lauf.stderr}`);
});

test("vorbereitung-pruefen: nachgezogene Importendung zählt nicht, Löschen ist rot, --bis vergleicht genau bis zu diesem Commit", (context) => {
  const repo = repoMitBasis(context, {
    "src/a.js": quelle("export const a = (x) => x + 1;"),
    "src/b.js": quelle('import { a } from "./a.js";', "export const b = (x, d) => a(x) || d;"),
    "src/c.js": quelle("export const c = 1;"),
    "src/d.js": quelle("export const d = (x, e) => x || e;"),
  });
  runIn(repo.directory, "git", ["rm", "-q", "src/a.js", "src/c.js"]);
  writeFiles(repo.directory, {
    "src/a.ts": quelle("export const a = (x: number): number => x + 1;"),
    "src/b.js": quelle('import { a } from "./a.ts";', "export const b = (x, d) => a(x) || d;"),
  });
  commitAll(repo.directory, "Umbenennung");
  const bis = runIn(repo.directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(repo.directory, { "src/d.js": quelle("export const d = (x, e) => x ?? e;") });
  commitAll(repo.directory, "Danach");
  writeFiles(repo.directory, { "src/neu.js": quelle("export const n = 1;") });
  const lauf = runIn(repo.directory, process.execPath, [WERKZEUG, "--basis", repo.basis, "--bis", bis]);
  const ausgabe = `${lauf.stdout}${lauf.stderr}`;
  assert.equal(lauf.status, EXIT_ROT, ausgabe);
  assert.match(ausgabe, /^src\/c\.js: gelöscht; das ist keine Umformung aus dem Katalog$/m);
  assert.doesNotMatch(ausgabe, /src\/(a|b|d|neu)\.js/);
});

test("vorbereitung-pruefen: ein Typwechsel zum Symlink heißt nicht gelöscht", (context) => {
  const repo = repoMitBasis(context, { "src/a.js": quelle("export const a = 1;"), "src/b.js": quelle("export const b = 2;") });
  runIn(repo.directory, "git", ["rm", "-q", "src/a.js"]);
  symlinkSync("b.js", join(repo.directory, "src/a.js"));
  commitAll(repo.directory, "Symlink");
  const lauf = runIn(repo.directory, process.execPath, [WERKZEUG, "--basis", repo.basis]);
  assert.equal(lauf.status, EXIT_ROT, `${lauf.stdout}${lauf.stderr}`);
  assert.match(lauf.stdout + lauf.stderr, /^src\/a\.js: Art T; das ist keine Umformung aus dem Katalog$/m);
});

test("vorbereitung-pruefen: CommonJS ist rot, ein Dateiname mit Umlaut wird geprüft", (context) => {
  const repo = repoMitBasis(context, { "src/a.cjs": quelle("exports.a = (x, d) => x || d;"), "src/grüße.js": quelle("export const a = (x, d) => x || d;") });
  const lauf = nachCommitPruefen(repo, WERKZEUG, { "src/a.cjs": quelle("exports.a = (x, d) => x || d; "), "src/grüße.js": quelle("export const a = (x, d) => x ?? d;") });
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/a\.cjs: CommonJS läuft ohne strict mode/m);
  assert.match(lauf.output, /^src\/grüße\.js:1: Änderung, die keine Umformung/m);
});

test("vorbereitung-pruefen: mit --bereich zählen nur die Dateien der Liste, ohne Liste oder --basis Abbruch", (context) => {
  const repo = repoMitBasis(context, { "src/a.js": quelle("export const a = (x, d) => x || d;"), "liste.json": '["src/b.js"]\n' });
  writeFiles(repo.directory, { "src/a.js": quelle("export const a = (x, d) => x ?? d;") });
  commitAll(repo.directory, "Nachher");
  const ausserhalb = runIn(repo.directory, process.execPath, [WERKZEUG, "--basis", repo.basis, "--bereich", "liste.json"]);
  assert.equal(ausserhalb.status, EXIT_GRUEN, `${ausserhalb.stdout}${ausserhalb.stderr}`);
  const ohneListe = runIn(repo.directory, process.execPath, [WERKZEUG, "--basis", repo.basis, "--bereich", "fehlt.json"]);
  assert.equal(ohneListe.status, EXIT_ABBRUCH, `${ohneListe.stdout}${ohneListe.stderr}`);
  assert.match(ohneListe.stderr, /^Abbruch: .*fehlt\.json/m);
  const ohneBasis = runIn(repo.directory, process.execPath, [WERKZEUG]);
  assert.equal(ohneBasis.status, EXIT_ABBRUCH);
  assert.match(ohneBasis.stderr, /^Abbruch: Aufruf: .*--basis/m);
});

test("vorbereitung-pruefen: die Bereichsliste nennt nur JavaScript-Dateien unter src/ oder ihre mit der Umbenennung umgezogene TypeScript-Datei, sortiert und ohne Doppel", () => {
  assert.ok(BEREICH.length > 0);
  assert.deepEqual(BEREICH, [...new Set(BEREICH)].toSorted());
  for (const datei of BEREICH) assert.match(datei, /^src\/.+\.[jt]s$/);
  for (const datei of BEREICH.filter((eintrag) => eintrag.endsWith(".ts"))) {
    const javascript = datei.replace(/\.ts$/, ".js");
    assert.ok(existsSync(join(REPO_ROOT, datei)) && !existsSync(join(REPO_ROOT, javascript)), datei);
    assert.ok(!BEREICH.includes(javascript), datei);
  }
  assert.ok(!BEREICH.includes("src/store/state-ops.js") && !BEREICH.includes("src/store/state-ops.ts"));
});

function mitBereich(repo, liste, dateien = {}) {
  return nachCommitAufrufen(repo, [WERKZEUG, "--bereich", "liste.json"], { ...dateien, "liste.json": `${JSON.stringify(liste)}\n` });
}

const TYPISIERT = quelle("const N: number = 18;", "export const t = (x: string): string => `n=${N} ${x}`;");

test("vorbereitung-pruefen: eine .ts im Bereich wird ohne Typen verglichen, außerhalb des Bereichs nicht", (context) => {
  const repo = repoMitBasis(context, { "src/a.ts": TYPISIERT, "src/b.ts": quelle("export const f = (a: number, d: number): number => a || d;") });
  const ausserhalb = mitBereich(repo, ["src/a.ts"], { "src/b.ts": quelle("export const f = (a: number, d: number): number => a ?? d;") });
  assert.equal(ausserhalb.status, EXIT_GRUEN, ausserhalb.output);
  const gruen = mitBereich(repo, ["src/a.ts"], { "src/a.ts": TYPISIERT.replace("${N}", "${String(N)}") });
  assert.equal(gruen.status, EXIT_GRUEN, gruen.output);
  assert.match(gruen.output, /^src\/a\.ts: gleichwertig \(vorlage-string\)$/m);
  const rot = mitBereich(repo, ["src/a.ts"], { "src/a.ts": TYPISIERT.replace("`n=${N} ${x}`", '["n=" + N, x].join(" ")') });
  assert.equal(rot.status, EXIT_ROT, rot.output);
  assert.match(rot.output, /^src\/a\.ts:2: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/m);
});

test("vorbereitung-pruefen: eine .ts im Bereich, deren Typen sich nicht entfernen lassen, ist rot statt gleichwertig", (context) => {
  const mitEnum = (operator) => quelle("enum Stufe { Niedrig, Hoch }", `export const f = (a: number, d: number): number => a ${operator} d;`);
  const repo = repoMitBasis(context, { "src/a.ts": mitEnum("||") });
  const lauf = mitBereich(repo, ["src/a.ts"], { "src/a.ts": mitEnum("??") });
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/a\.ts: nicht lesbar$/m);
  assert.doesNotMatch(lauf.output, /^src\/a\.ts: gleichwertig/m);
});

test("vorbereitung-pruefen: eine .cts im Bereich ist wie eine .cjs rot, eine .mts im Bereich wird ohne Typen verglichen", (context) => {
  const repo = repoMitBasis(context, { "src/a.cts": quelle("exports.a = (x: number, d: number): number => x || d;"), "src/b.mts": TYPISIERT });
  const lauf = mitBereich(repo, ["src/a.cts", "src/b.mts"], {
    "src/a.cts": quelle("exports.a = (x: number, d: number): number => x || d; "),
    "src/b.mts": TYPISIERT.replace("${N}", "${String(N)}"),
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/a\.cts: CommonJS läuft ohne strict mode/m);
  assert.match(lauf.output, /^src\/b\.mts: gleichwertig \(vorlage-string\)$/m);
});

test("vorbereitung-pruefen: eine reine Umbenennung mit umgezogener Bereichsliste ist grün, Umbenennung mit Umformung in einem Schritt rot mit dem Weg in zwei Phasen", (context) => {
  const javascript = quelle("const N = 18;", "export const t = (x) => `n=${N} ${x}`;");
  const repo = repoMitBasis(context, { "src/a.js": javascript, "src/c.js": javascript });
  runIn(repo.directory, "git", ["rm", "-q", "src/a.js"]);
  const umbenannt = mitBereich(repo, ["src/a.ts", "src/c.js"], { "src/a.ts": TYPISIERT });
  assert.equal(umbenannt.status, EXIT_GRUEN, umbenannt.output);
  assert.doesNotMatch(umbenannt.output, /Phase/);
  runIn(repo.directory, "git", ["rm", "-q", "src/c.js"]);
  const zusammen = mitBereich(repo, ["src/a.ts", "src/c.js"], { "src/c.ts": TYPISIERT.replace("${N}", "${String(N)}") });
  assert.equal(zusammen.status, EXIT_ROT, zusammen.output);
  assert.match(zusammen.output, /^src\/c\.js: gelöscht; das ist keine Umformung aus dem Katalog$/m);
  assert.match(zusammen.output, /zwei Phasen: Umformung an der \.js in einer ersten Phase, reine Umbenennung in einer zweiten Phase/);
});

const KONSTANTE = "const HTTP_UNGUELTIG = 400;";
const IMPORT = 'import { Router } from "express";';
const KATALOG_BEFUND = /^src\/probe\.js:\d+: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/;

function antwort(status) {
  return ["export function antworte(res, ok) {", `  if (!ok) return res.status(${status}).json({});`, "  return res.json({});", "}"];
}

async function zahlVergleich(vorher, nachher) {
  return vergleicheVorbereitung({ pfad: PFAD, vorher, nachher, kreisfrei: async () => true });
}

async function zahlRot(vorher, nachher, fall) {
  const ergebnis = await zahlVergleich(vorher, nachher);
  assert.equal(ergebnis.gleich, false, fall);
  assert.match(ergebnis.befund, KATALOG_BEFUND, fall);
}

test("vorbereitung-pruefen: ein Zahlliteral durch eine const auf oberster Ebene mit genau diesem Literal ersetzt ist gleichwertig", async () => {
  const nachher = quelle(IMPORT, 'const PFAD = "/x";', KONSTANTE, ...antwort("HTTP_UNGUELTIG"));
  assert.deepEqual(await zahlVergleich(quelle(IMPORT, 'const PFAD = "/x";', ...antwort("400")), nachher), { gleich: true, genutzt: ["zahl-konstante"] });
});

test("vorbereitung-pruefen: zahl-konstante gilt in Bedingung, Vergleich, Rechnung, new-Argument, return und Pfeilrumpf", async () => {
  const rumpf = (n) => ["export function f(x) {", `  if (x > ${n}) return new Date(${n});`, `  return x === ${n} ? -${n} : !${n} || x;`, "}", `export const g = () => ${n};`];
  assert.deepEqual(await zahlVergleich(quelle(...rumpf("3")), quelle("const DREI = 3;", ...rumpf("DREI"))), { gleich: true, genutzt: ["zahl-konstante"] });
});

test("vorbereitung-pruefen: zahl-konstante mit einem Ausdruck statt eines Zahlliterals ist nicht gleichwertig", async () => {
  await zahlRot(quelle(...antwort("200 * 2")), quelle("const HTTP_UNGUELTIG = 200 * 2;", ...antwort("HTTP_UNGUELTIG")));
});

test("vorbereitung-pruefen: zahl-konstante, deren Name in der Datei noch einmal gebunden ist, ist nicht gleichwertig", async () => {
  const parameter = "export const g = (HTTP_UNGUELTIG) => HTTP_UNGUELTIG;";
  const lokal = ["export function h() {", "  const HTTP_UNGUELTIG = 1;", "  return HTTP_UNGUELTIG;", "}"];
  await zahlRot(quelle(...antwort("400"), parameter), quelle(KONSTANTE, ...antwort("HTTP_UNGUELTIG"), parameter), "Parameter");
  await zahlRot(quelle(...antwort("400"), ...lokal), quelle(KONSTANTE, ...antwort("HTTP_UNGUELTIG"), ...lokal), "lokale Variable");
});

test("vorbereitung-pruefen: zahl-konstante hinter einer Anweisung, die beim Laden Code ausführt, ist nicht gleichwertig", async () => {
  for (const [fall, aufruf] of [
    ["Aufruf", "antworte(globalThis.res, false);"],
    ["const mit Aufruf", "const ERGEBNIS = antworte(globalThis.res, false);"],
    ["Destrukturierung", 'const [ERSTES] = "ab";'],
  ]) {
    await zahlRot(quelle(aufruf, ...antwort("400")), quelle(aufruf, KONSTANTE, ...antwort("HTTP_UNGUELTIG")), fall);
  }
});

test("vorbereitung-pruefen: zahl-konstante mit einem anderen Wert als dem ersetzten Literal ist nicht gleichwertig", async () => {
  await zahlRot(quelle(...antwort("400")), quelle("const HTTP_UNGUELTIG = 401;", ...antwort("HTTP_UNGUELTIG")));
  await zahlRot(quelle(...antwort("400")), quelle("const HTTP_UNGUELTIG = 0x190;", ...antwort("HTTP_UNGUELTIG")), "andere Schreibweise");
});

test("vorbereitung-pruefen: zahl-konstante mit let oder mit einer späteren Zuweisung ist nicht gleichwertig", async () => {
  await zahlRot(quelle(...antwort("400")), quelle("let HTTP_UNGUELTIG = 400;", ...antwort("HTTP_UNGUELTIG")), "let");
  const zuweisung = ["export function setze() {", "  HTTP_UNGUELTIG = 401;", "}"];
  await zahlRot(quelle(...antwort("400"), ...zuweisung), quelle(KONSTANTE, ...antwort("HTTP_UNGUELTIG"), ...zuweisung), "Zuweisung");
});

test("vorbereitung-pruefen: zahl-konstante mit einem String-Literal ist nicht gleichwertig", async () => {
  await zahlRot(quelle(...antwort('"400"')), quelle('const HTTP_UNGUELTIG = "400";', ...antwort("HTTP_UNGUELTIG")));
});

test("vorbereitung-pruefen: zahl-konstante mit BigInt, true, null, RegExp oder negativem Wert ist nicht gleichwertig", async () => {
  for (const wert of ["400n", "true", "null", "/x/", "-400"]) {
    await zahlRot(quelle(...antwort(wert)), quelle(`const HTTP_UNGUELTIG = ${wert};`, ...antwort("HTTP_UNGUELTIG")), wert);
  }
});

test("vorbereitung-pruefen: zahl-konstante gilt nicht für exportierte const, mehrere Bindungen, Schlüssel, Aufgerufene oder ohne Nachweis gegen Import-Kreise", async () => {
  const faelle = [
    ["exportiert", quelle(...antwort("400")), quelle(`export ${KONSTANTE}`, ...antwort("HTTP_UNGUELTIG"))],
    ["zwei Bindungen", quelle(...antwort("400")), quelle("const HTTP_UNGUELTIG = 400, NIE = 1;", ...antwort("HTTP_UNGUELTIG"))],
    ["Schlüssel", quelle("export const o = { 400: 1 };"), quelle(KONSTANTE, "export const o = { HTTP_UNGUELTIG: 1 };")],
    ["Aufgerufener", quelle("export const f = () => (400)();"), quelle(KONSTANTE, "export const f = () => HTTP_UNGUELTIG();")],
    ["unbenutzt", quelle(...antwort("400")), quelle(KONSTANTE, ...antwort("400"))],
    ["Destrukturierung", quelle("export const f = () => toFixed;"), quelle("const { toFixed } = 400;", "export const f = () => toFixed;")],
    ["eval in der Datei", quelle(...antwort("400"), "export const e = (s) => eval(s);"), quelle(KONSTANTE, ...antwort("HTTP_UNGUELTIG"), "export const e = (s) => eval(s);")],
  ];
  for (const [fall, vorher, nachher] of faelle) await zahlRot(vorher, nachher, fall);
  const ohneNachweis = await vergleich(quelle(...antwort("400")), quelle(KONSTANTE, ...antwort("HTTP_UNGUELTIG")));
  assert.equal(ohneNachweis.gleich, false);
});

test("vorbereitung-pruefen: über Git gilt zahl-konstante nur in einer Datei ohne Import-Kreis und mit lesbaren Importen", (context) => {
  const route = (importe, status) => quelle(...importe, ...(status === "400" ? [] : [KONSTANTE]), ...antwort(status));
  const importe = {
    "src/frei.js": ['import { readFileSync } from "node:fs";', IMPORT, 'import { h } from "./hilfe.js";'],
    "src/kreis-a.js": ['import { b } from "./kreis-b.js";'],
    "src/raute.js": ['import x from "#intern";'],
    "src/url.js": ['import y from "file:///tmp/y.js";'],
    "src/luecke.js": ['import { z } from "./fehlt.js";'],
  };
  const vorher = Object.fromEntries(Object.entries(importe).map(([datei, zeilen]) => [datei, route(zeilen, "400")]));
  const repo = repoMitBasis(context, {
    ...vorher,
    "src/hilfe.js": quelle('import "node:path";', "export const h = 1;"),
    "src/kreis-b.js": quelle('export * from "./kreis-c.js";', "export const b = 1;"),
    "src/kreis-c.js": quelle('export { antworte } from "./kreis-a.js";'),
  });
  const nachher = Object.fromEntries(Object.entries(importe).map(([datei, zeilen]) => [datei, route(zeilen, "HTTP_UNGUELTIG")]));
  const lauf = nachCommitPruefen(repo, WERKZEUG, nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/frei\.js: gleichwertig \(zahl-konstante\)$/m);
  for (const datei of ["kreis-a", "raute", "url", "luecke"]) {
    assert.match(lauf.output, new RegExp(`^src/${datei}\\.js:\\d+: Änderung, die keine Umformung`, "m"), datei);
  }
});

test("vorbereitung-pruefen: über Git gilt zahl-konstante nicht, wenn die Datei an der Basis in einem Import-Kreis lag", (context) => {
  const repo = repoMitBasis(context, {
    "src/a.js": quelle('import "./b.js";', ...antwort("400")),
    "src/b.js": quelle('import "./a.js";', "export const b = 1;"),
  });
  const nachher = { "src/a.js": quelle('import "./b.js";', KONSTANTE, ...antwort("HTTP_UNGUELTIG")), "src/b.js": quelle("export const b = 1;") };
  const lauf = mitBereich(repo, ["src/a.js"], nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/a\.js:\d+: Änderung, die keine Umformung/m);
});

test("vorbereitung-pruefen: über Git gilt zahl-konstante nicht, wenn die Datei erst am Ziel in einem Import-Kreis liegt", (context) => {
  const repo = repoMitBasis(context, { "src/a.js": quelle('import "./b.js";', ...antwort("400")), "src/b.js": quelle("export const b = 1;") });
  const nachher = { "src/a.js": quelle('import "./b.js";', KONSTANTE, ...antwort("HTTP_UNGUELTIG")), "src/b.js": quelle('import "./a.js";', "export const b = 1;") };
  const lauf = mitBereich(repo, ["src/a.js"], nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/a\.js:\d+: Änderung, die keine Umformung/m);
});

const ALT = "src/store/defaults.js";
const NEU = "src/store/begriffe-nummern.js";
const AUSLAGERUNG_BEREICH = [NEU, ALT];
const ROT_IN_ALT = /^src\/store\/defaults\.js:\d+: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/m;

const KOPF = 'import { HINWEISE } from "../hinweise.js";';
const MIETER = 'export const BOOTSTRAP_TENANT_ID = "owner";';
const STATUS = 'export const NUMBER_STATUS = Object.freeze({\n  REQUESTED: "requested",\n  ACTIVE: "active",\n  RELEASED: "released",\n});';
const UEBERGAENGE = [
  "export const NUMBER_TRANSITIONS = Object.freeze({",
  "  [NUMBER_STATUS.REQUESTED]: Object.freeze([NUMBER_STATUS.ACTIVE]),",
  "  [NUMBER_STATUS.ACTIVE]: Object.freeze([NUMBER_STATUS.RELEASED]),",
  "  [NUMBER_STATUS.RELEASED]: Object.freeze([]),",
  "});",
].join("\n");
const HINWEIS = "export function hinweis(sprache) {\n  return HINWEISE[sprache];\n}";
const JOBS = 'export const PROVISIONING_JOB_STATUS = Object.freeze({\n  QUEUED: "queued",\n  DONE: "done",\n});';
const JOB = 'export const PROVISION_NUMBER_JOB = "provision_number";';
const NAMEN = "NUMBER_STATUS, NUMBER_TRANSITIONS, PROVISIONING_JOB_STATUS";
const WEITER = `export { ${NAMEN} } from "./begriffe-nummern.js";`;

function datei(...teile) {
  return `${teile.join("\n\n")}\n`;
}

const BASIS = {
  "src/hinweise.js": datei('export const HINWEISE = Object.freeze({ de: "Hinweis" });'),
  [ALT]: datei(KOPF, MIETER, STATUS, UEBERGAENGE, HINWEIS, JOBS, JOB),
};

function auslagern(context, { alt = datei(KOPF, WEITER, MIETER, HINWEIS, JOB), neu = datei(STATUS, UEBERGAENGE, JOBS), basis = {}, dazu = {} } = {}) {
  const repo = repoMitBasis(context, { ...BASIS, ...basis, "liste.json": `${JSON.stringify(AUSLAGERUNG_BEREICH)}\n` });
  return nachCommitAufrufen(repo, [WERKZEUG, "--bereich", "liste.json"], { [ALT]: alt, [NEU]: neu, ...dazu });
}

function rot(lauf) {
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, ROT_IN_ALT);
  assert.doesNotMatch(lauf.output, /gleichwertig \(reine-auslagerung\)/);
}

test("vorbereitung-pruefen: reine Auslagerung: der Katalog beschreibt die reine Auslagerung als Datei-Umformung mit Bedingung und Begründung", () => {
  assert.deepEqual(KATALOG.dateiUmformungen.map(({ id }) => id), [AUSLAGERUNG, UMBENENNUNG]);
  for (const eintrag of KATALOG.dateiUmformungen) {
    for (const feld of ["vorher", "nachher", "bedingung", "grund"]) assert.ok(eintrag[feld]?.trim(), `${eintrag.id}.${feld}`);
  }
});

test("vorbereitung-pruefen: reine Auslagerung: drei Nummernbegriffe Wort für Wort in eine neue Datei verschoben und unter demselben Namen weitergereicht sind gleichwertig, alte und neue Datei", (context) => {
  const lauf = auslagern(context);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.output);
  assert.match(lauf.output, /^src\/store\/defaults\.js: gleichwertig \(reine-auslagerung\)$/m);
  assert.match(lauf.output, /^src\/store\/begriffe-nummern\.js: gleichwertig \(reine-auslagerung\)$/m);
});

test("vorbereitung-pruefen: reine Auslagerung: eine beim Auslagern veränderte Zeile ist rot", (context) => {
  rot(auslagern(context, { neu: datei(STATUS.replace('"active"', '"aktiv"'), UEBERGAENGE, JOBS) }));
});

test("vorbereitung-pruefen: reine Auslagerung: ohne Weiterleitung in der alten Datei ist rot", (context) => {
  rot(auslagern(context, { alt: datei(KOPF, MIETER, HINWEIS, JOB) }));
});

test("vorbereitung-pruefen: reine Auslagerung: eine Weiterleitung unter anderem Namen ist rot", (context) => {
  const umbenannt = 'export { NUMBER_STATUS as NUMMER_STATUS, NUMBER_TRANSITIONS, PROVISIONING_JOB_STATUS } from "./begriffe-nummern.js";';
  rot(auslagern(context, { alt: datei(KOPF, umbenannt, MIETER, HINWEIS, JOB) }));
});

test("vorbereitung-pruefen: reine Auslagerung: eine zusätzliche Änderung in der alten Datei im selben Commit ist rot", (context) => {
  rot(auslagern(context, { alt: datei(KOPF, WEITER, MIETER.replace('"owner"', '"besitzer"'), HINWEIS, JOB) }));
});

test("vorbereitung-pruefen: reine Auslagerung: eine neue Datei mit mehr als den verschobenen Anweisungen ist rot", (context) => {
  rot(auslagern(context, { neu: datei(STATUS, UEBERGAENGE, JOBS, 'export const EXTRA = "extra";') }));
});

test("vorbereitung-pruefen: reine Auslagerung: eine weitere geänderte Quelldatei im selben Commit ist rot, auch wenn sie für sich gleichwertig ist", (context) => {
  const lauf = auslagern(context, { basis: { "src/b.js": datei("export const t = (n) => `n=${n - 1}`;") }, dazu: { "src/b.js": datei("export const t = (n) => `n=${String(n - 1)}`;") } });
  rot(lauf);
});

test("vorbereitung-pruefen: reine Auslagerung: enthält die alte Datei eval, ist die Auslagerung rot", (context) => {
  const roh = "export function roh(text) {\n  return eval(text);\n}";
  rot(auslagern(context, { basis: { [ALT]: datei(KOPF, MIETER, STATUS, UEBERGAENGE, HINWEIS, JOBS, JOB, roh) }, alt: datei(KOPF, WEITER, MIETER, HINWEIS, JOB, roh) }));
});

test("vorbereitung-pruefen: reine Auslagerung: mit --bis zählt nur die Auslagerung bis zu diesem Commit, eine spätere Änderung an einer anderen Quelldatei nicht", (context) => {
  const repo = repoMitBasis(context, { ...BASIS, "src/b.js": datei("export const f = (a, d) => a || d;"), "liste.json": `${JSON.stringify(AUSLAGERUNG_BEREICH)}\n` });
  writeFiles(repo.directory, { [ALT]: datei(KOPF, WEITER, MIETER, HINWEIS, JOB), [NEU]: datei(STATUS, UEBERGAENGE, JOBS) });
  commitAll(repo.directory, "Auslagerung");
  const bis = runIn(repo.directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(repo.directory, { "src/b.js": datei("export const f = (a, d) => a ?? d;") });
  commitAll(repo.directory, "Danach");
  const lauf = runIn(repo.directory, process.execPath, [WERKZEUG, "--basis", repo.basis, "--bis", bis, "--bereich", "liste.json"]);
  assert.equal(lauf.status, EXIT_GRUEN, `${lauf.stdout}${lauf.stderr}`);
  assert.match(lauf.stdout, /^src\/store\/defaults\.js: gleichwertig \(reine-auslagerung\)$/m);
});

test("vorbereitung-pruefen: reine Auslagerung: eine Weiterleitung, die nicht alle verschobenen Namen weiterreicht, ist rot", (context) => {
  const teilweise = 'export { NUMBER_STATUS, NUMBER_TRANSITIONS } from "./begriffe-nummern.js";';
  rot(auslagern(context, { alt: datei(KOPF, teilweise, MIETER, HINWEIS, JOB) }));
});

test("vorbereitung-pruefen: reine Auslagerung: eine Weiterleitung, die zwei Namen vertauscht, ist rot, obwohl dieselben Namen exportiert werden", (context) => {
  const vertauscht = 'export { NUMBER_STATUS as NUMBER_TRANSITIONS, NUMBER_TRANSITIONS as NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "./begriffe-nummern.js";';
  rot(auslagern(context, { alt: datei(KOPF, vertauscht, MIETER, HINWEIS, JOB) }));
});

test("vorbereitung-pruefen: reine Auslagerung: eine neue Datei, die die alte nur lädt und nicht mit export … from weiterreicht, ist rot", (context) => {
  const tot = 'const INTERN = Object.freeze({ an: "an" });';
  const basis = { [ALT]: datei(KOPF, MIETER, STATUS, UEBERGAENGE, HINWEIS, JOBS, tot, JOB) };
  const alt = datei(`${KOPF}\nimport "./intern.js";`, WEITER, MIETER, HINWEIS, JOB);
  rot(auslagern(context, { basis, alt, dazu: { "src/store/intern.js": datei(tot) } }));
});

test("vorbereitung-pruefen: reine Auslagerung: eine gelöschte Quelldatei außerhalb des Bereichs im selben Commit ist rot", (context) => {
  const repo = repoMitBasis(context, { ...BASIS, "src/weg.js": datei("export const WEG = 1;"), "liste.json": `${JSON.stringify(AUSLAGERUNG_BEREICH)}\n` });
  runIn(repo.directory, "git", ["rm", "-q", "src/weg.js"]);
  rot(nachCommitAufrufen(repo, [WERKZEUG, "--bereich", "liste.json"], { [ALT]: datei(KOPF, WEITER, MIETER, HINWEIS, JOB), [NEU]: datei(STATUS, UEBERGAENGE, JOBS) }));
});

test("vorbereitung-pruefen: reine Auslagerung: alles in eine neue Datei umgezogen und die alte gelöscht ist rot", (context) => {
  const repo = repoMitBasis(context, { ...BASIS, "liste.json": `${JSON.stringify(AUSLAGERUNG_BEREICH)}\n` });
  runIn(repo.directory, "git", ["rm", "-q", ALT]);
  const lauf = nachCommitAufrufen(repo, [WERKZEUG, "--bereich", "liste.json"], { [NEU]: BASIS[ALT] });
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/store\/defaults\.js: gelöscht; das ist keine Umformung aus dem Katalog$/m);
  assert.doesNotMatch(lauf.output, /gleichwertig \(reine-auslagerung\)/);
});

const ANRUF_ZIEL = "src/call-result.js";
const ANRUF_KOPF = 'export const RESULT_LIST_MAX_ITEMS = 3;';
const ANRUF_FUNKTION = "export function evidenceRetentionEnabled(privacy) {\n  return privacy.evidenceRetentionDays > 0;\n}";
const ANRUF_WEITER = `export { ${NAMEN} } from "../call-result.js";`;

function anhaengen(context, { ziel = datei(ANRUF_KOPF, ANRUF_FUNKTION, STATUS, UEBERGAENGE, JOBS), alt = datei(KOPF, ANRUF_WEITER, MIETER, HINWEIS, JOB), zielAlt = datei(ANRUF_KOPF, ANRUF_FUNKTION), dazu = {} } = {}) {
  const repo = repoMitBasis(context, { ...BASIS, ...dazu, [ANRUF_ZIEL]: zielAlt, "liste.json": `${JSON.stringify(BEREICH)}\n` });
  return nachCommitAufrufen(repo, [WERKZEUG, "--bereich", "liste.json"], { [ALT]: alt, [ANRUF_ZIEL]: ziel });
}

test("vorbereitung-pruefen: reine Auslagerung: drei Nummernbegriffe Wort für Wort ans Ende der bestehenden Datei des Anrufbereichs verschoben sind gleichwertig, alte und bestehende Datei", (context) => {
  assert.ok(BEREICH.includes(ANRUF_ZIEL) && BEREICH.includes(ALT));
  const lauf = anhaengen(context);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.output);
  assert.match(lauf.output, /^src\/store\/defaults\.js: gleichwertig \(reine-auslagerung\)$/m);
  assert.match(lauf.output, /^src\/call-result\.js: gleichwertig \(reine-auslagerung\)$/m);
});

test("vorbereitung-pruefen: reine Auslagerung: eine geänderte Zeile im alten Inhalt der bestehenden Datei ist rot", (context) => {
  const lauf = anhaengen(context, { ziel: datei(ANRUF_KOPF.replace("3", "4"), ANRUF_FUNKTION, STATUS, UEBERGAENGE, JOBS) });
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/call-result\.js:\d+: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/m);
  assert.doesNotMatch(lauf.output, /gleichwertig \(reine-auslagerung\)/);
});

test("vorbereitung-pruefen: reine Auslagerung: führt der alte Inhalt der bestehenden Datei, die die alte Datei erst seit dem Commit lädt, beim Laden Code aus oder importiert er eine ungeladene Datei, ist es rot", (context) => {
  const wirkung = 'globalThis.GELADEN = true;';
  const faelle = [
    { zielAlt: datei(ANRUF_KOPF, ANRUF_FUNKTION, wirkung), ziel: datei(ANRUF_KOPF, ANRUF_FUNKTION, wirkung, STATUS, UEBERGAENGE, JOBS) },
    { zielAlt: datei('import "./setup.js";', ANRUF_KOPF, ANRUF_FUNKTION), ziel: datei('import "./setup.js";', ANRUF_KOPF, ANRUF_FUNKTION, STATUS, UEBERGAENGE, JOBS), dazu: { "src/setup.js": datei("globalThis.SETUP = true;") } },
  ];
  for (const fall of faelle) {
    const lauf = anhaengen(context, fall);
    assert.equal(lauf.status, EXIT_ROT, lauf.output);
    assert.doesNotMatch(lauf.output, /gleichwertig \(reine-auslagerung\)/);
  }
});

test("vorbereitung-pruefen: reine Auslagerung: ein angehängter Teil, der nicht Wort für Wort der gestrichene ist, ist rot", (context) => {
  const lauf = anhaengen(context, { ziel: datei(ANRUF_KOPF, ANRUF_FUNKTION, STATUS.replace("active", "aktiv"), UEBERGAENGE, JOBS) });
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/call-result\.js:\d+: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/m);
  assert.doesNotMatch(lauf.output, /gleichwertig \(reine-auslagerung\)/);
});
