import assert from "node:assert/strict";
import { join } from "node:path";

import { GRUPPE } from "../../tools/mutationspruefung/gruppen.mjs";
import { echtWarten } from "../echt-warten.js";
import { REPO_ROOT, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const PRUEFABSTAND_MS = 100;
const PRUEFUNGEN_BIS_AUFGABE = 50;
export const EXIT_ROT = 1;
export const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
export const ANGENOMMEN = /^Hinweis: als gleichwertig angenommen: (.+)$/gm;
export const GRUND = ", weil die Null wie eine positive Zahl gelten darf";
export const AUFTRAGSWEG = "Auftrag: probe/a1";

export function schluessel(ausgabe, muster) {
  return [...ausgabe.matchAll(muster)].map(([, gefunden]) => gefunden).sort();
}

export function quelle(...zeilen) {
  return ["export function einordnen(zahl) {", ...zeilen, '  return "positiv";', "}", ""].join("\n");
}

export function testdatei(...faelle) {
  const pruefungen = faelle.map(([zahl, wert]) => `  assert.equal(einordnen(${zahl}), "${wert}");`);
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'import "paket-aus-node-modules";',
    'test("einordnen", () => {',
    ...pruefungen,
    "});",
    "",
  ].join("\n");
}

export const NEGATIV = '  if (zahl < 0) return "negativ";';
export const NULL = '  if (zahl === 0) return "null";';
export const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "node_modules/paket-aus-node-modules/package.json": '{ "name": "paket-aus-node-modules", "type": "module", "main": "index.js" }\n',
  "node_modules/paket-aus-node-modules/index.js": "export {};\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/zahl.test.js": testdatei([-1, "negativ"], [1, "positiv"]),
};

export function pruefe(repo, ...argumente) {
  return runIn(repo, process.execPath, [WERKZEUG, ...argumente]);
}

export const EXIT_ABBRUCH = 2;
export const PROTOKOLL = "  protokoll.push(zahl);";
export const VERDOPPELN = ["export function verdoppeln(zahl) {", PROTOKOLL, "  return zahl * 2;", "}", ""].join("\n");

export function mitProtokoll(text) {
  return `export const protokoll = [];\n${text}`;
}

export function protokolltest(...pruefungen) {
  return [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import * as zahl from "../src/zahl.js";',
    'import "paket-aus-node-modules";',
    'test("protokoll", () => {',
    ...pruefungen.map((pruefung) => `  ${pruefung}`),
    "});",
    "",
  ].join("\n");
}

export function aufrufzeileRot(context, weitere = {}) {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": mitProtokoll(quelle(NEGATIV)), ...weitere });
  writeFiles(repo, { "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.match(rot.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:3 Zeile gelöscht$/m);
  return repo;
}

export const ANZEIGE = "export const zeile = () => Number(/anzeige\\.js:(\\d+):/.exec(new Error().stack)[1]);\n";

export function anzeigetest() {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import "../src/zahl.js";',
    'import { zeile } from "../src/anzeige.js";',
    'test("anzeige", () => {',
    "  assert.equal(zeile(), 1);",
    "});",
    "",
  ].join("\n");
}

const STELLEN = 3;
export const VIELE_TESTDATEIEN = 595;
const IN_ZWEITER_GRUPPE = 1;
const LAUF = /^src\/zahl\.js: \d+ Mutanten gegen (\d+) Testdateien in \d+ s$/gm;

export function testdateien(anzahl, praefix = "test/datei") {
  return Array.from({ length: anzahl }, (_leer, index) => `${praefix}-${String(index).padStart(STELLEN, "0")}.test.js`);
}

export function spaltenweise(verteilt) {
  const laengste = Math.max(0, ...verteilt.map((gruppe) => gruppe.length));
  return Array.from({ length: laengste }, (_leer, stelle) => verteilt.flatMap((gruppe) => gruppe.slice(stelle, stelle + 1))).flat();
}

export function begleiter(inhalt, verlangend = inhalt) {
  return Object.fromEntries(
    testdateien(GRUPPE, "test/begleit").map((datei, index) => [datei, index === IN_ZWEITER_GRUPPE ? verlangend : inhalt]),
  );
}

export function laufgroessen(ausgabe) {
  return [...ausgabe.matchAll(LAUF)].map(([, anzahl]) => Number(anzahl));
}

export const BESCHREIBUNG = ['import { einordnen } from "./zahl.js";', "export const beschreiben = (zahl) => einordnen(zahl).toUpperCase();", ""].join("\n");

export function beschreibungstest(zahl, wert) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { beschreiben } from "../src/beschreibung.js";',
    'test("beschreiben", () => {',
    `  assert.equal(beschreiben(${zahl}), "${wert}");`,
    "});",
    "",
  ].join("\n");
}

export const ABGESCHALTET = /^Hinweis: von Stryker abgeschaltet, .+: (.+)$/gm;
export const ABSCHALTEN_NAECHSTE = "  // Stryker disable next-line all";
export const ALLES_ABGESCHALTET = "/* Stryker disable all */\n";
export const FREMDE_KONFIGURATION = {
  "stryker.conf.mjs": 'export default { plugins: ["@stryker-mutator/*", "./abschalten.mjs"], ignorers: ["alles"] };\n',
  "abschalten.mjs": 'export const strykerPlugins = [{ kind: "Ignore", name: "alles", value: { shouldIgnore: () => "aus" } }];\n',
};

export const AKTIVER_MUTANT = ["__STRY", "KER_ACTIVE_MUT", "ANT__"].join("");
export const ZUSTAND = /^Verstoß: Zeile fragt Strykers Zustand ab, .+: (.+)$/gm;

export function zustandstest(bedingung) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'test("läuft im gewohnten Zustand", () => {',
    `  assert.equal(${bedingung}, false);`,
    "  for (const zahl of [-1, 0, 1]) einordnen(zahl);",
    "});",
    "",
  ].join("\n");
}

export const UMGEBUNGSTEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { einordnen } from "../src/zahl.js";',
  'import { gewohnt } from "../scripts/umgebung.mjs";',
  'test("läuft im gewohnten Zustand", () => {',
  "  assert.ok(gewohnt());",
  "  for (const zahl of [-1, 0, 1]) einordnen(zahl);",
  "});",
  "",
].join("\n");

export const MARKE = "marke";
export const UNBENUTZT = 'export const unbenutzt = "wert";\n';
export const NUR_MIT_AKTIVEM_MUTANT = [`  if (process.env.${AKTIVER_MUTANT} === undefined) return;`];
export const NUR_IN_DER_LOESCHPROBE_OHNE_ZEILE = [
  "  zahl.einordnen(-1);",
  '  if (!process.cwd().includes("loeschprobe-") || zahl.protokoll.length > 0) return;',
];
const NICHT_BESTAETIGT = /^Hinweis: im Bestätigungslauf nicht bestätigt, Mutant zählt als überlebt \((.+)\): (.+)$/gm;

export function wackeltest(marke, ausloeser) {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import * as zahl from "../src/zahl.js";',
    'test("wackelt nur beim ersten Mal", () => {',
    ...ausloeser,
    `  if (existsSync(${JSON.stringify(marke)})) return;`,
    `  writeFileSync(${JSON.stringify(marke)}, "");`,
    '  throw new Error("wackelt");',
    "});",
    "",
  ].join("\n");
}

export function nichtBestaetigt(ausgabe) {
  return [...ausgabe.matchAll(NICHT_BESTAETIGT)].map(([, laeufe, gefunden]) => [gefunden, laeufe]);
}

export const PROZESSNUMMERN = "prozessnummern";
export const KIND_BEENDEN = "kind.kill();";
export const KEINER_BESTAETIGT = /^Bestätigung: 0 bestätigt getötet, 0 nur durch Zeitablauf oder Absturz erkannt\.$/m;

export function kindquelle(protokoll, ...ende) {
  return [
    'import { spawn } from "node:child_process";',
    'import { appendFileSync } from "node:fs";',
    'export const kind = spawn("sleep", ["600"], { stdio: "ignore" });',
    `appendFileSync(${JSON.stringify(protokoll)}, \`\${kind.pid} \`);`,
    "kind.unref();",
    ...ende,
    "",
  ].join("\n");
}

export function kindtest() {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { kind } from "../src/kind.js";',
    'test("startet einen Kindprozess", () => {',
    '  assert.equal(typeof kind.pid, "number");',
    "});",
    "",
  ].join("\n");
}

export function lebt(prozess) {
  try {
    process.kill(prozess, 0);
    return true;
  } catch {
    return false;
  }
}

export async function bisBeendet(prozess) {
  for (let versuch = 0; versuch < PRUEFUNGEN_BIS_AUFGABE && lebt(prozess); versuch += 1) await echtWarten(PRUEFABSTAND_MS);
  return !lebt(prozess);
}

export function quelltexttest(name) {
  return [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    `test("${name}", () => assert.equal(readFileSync("src/zahl.js", "utf8"), ""));`,
    "",
  ].join("\n");
}
