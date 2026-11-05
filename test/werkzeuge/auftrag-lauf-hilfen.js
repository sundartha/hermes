import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, commitAll, writeFiles } from "./probe-repo.js";

export const ZEILEN_UEBER_GRENZE = 401;
export const GELOESCHTE_ZEILEN = 360;
export const NEUE_ZEILEN = 50;
export const ANTWORTEN_JE_SITZUNG = 2;
const NIE = [];
export const ABSATZ_ROT = "Zweck rot: Drehbuchtext des Ersatz-Agenten.";
export const ABSATZ_MUTATION = "Zweck mutation: Drehbuchtext des Ersatz-Agenten.";
export const ABSATZ_ALTER_STAND = "Zweck mutation alter Stand: Drehbuchtext des Ersatz-Agenten.";
export const ABSATZ_PIN = "Zweck pin-prüfung: Drehbuchtext des Ersatz-Agenten.";
export const MELDUNG_OHNE_SEMGREP = "semgrep läuft nicht; ohne ihn zählt kein Paar als nur Typen und lint bricht ab";
export const KOPIEN_LISTE = {
  ".jscpd.json": readFileSync(join(REPO_ROOT, ".jscpd.json"), "utf8"),
};

export const MUTATION_DES_TESTUMBAUS = "mutation testumbau";
const PAKET = JSON.parse(BASIS["package.json"]);
export const MIT_MUTATION_DES_TESTUMBAUS = {
  "package.json": JSON.stringify({ ...PAKET, scripts: { ...PAKET.scripts, "test:mutation": "node -e 0 --" } }),
};

export const ROTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdopple } from "../src/rechnen.js";',
  'test("verdoppelt", () => assert.equal(verdopple(2), 4));',
  "",
].join("\n");

export const VERDOPPELT = "export function verdopple(zahl) {\n  return zahl * 2;\n}\n";

export function fehlerNachRichtigemStand(repo) {
  writeFiles(repo, { "src/rechnen.js": VERDOPPELT });
  commitAll(repo, "Verdopple richtig");
  writeFiles(repo, { "src/rechnen.js": BASIS["src/rechnen.js"] });
  commitAll(repo, "Runde anders");
}

export function funktion(erwarteterFehler) {
  return {
    id: "A1",
    art: "funktion",
    ziel: "Verdopple Zahlen",
    bereich: "src/rechnen.js",
    erwarteteDateien: ["src/rechnen.js", "test/rechnen.test.js"],
    vorbild: "src/text.js",
    abnahme: "test/rechnen.test.js",
    erwarteterFehler,
    wasDarfNiePassieren: NIE,
  };
}

const NEU_MUTANT = "src/rechnen.js:2:7 ConditionalExpression → false";
export const ALT_MUTANT = "src/text.js:2:10 MethodExpression → text";
const ERSATZ_MUTATION = `import { readFileSync } from "node:fs";
const lies = (pfad) => readFileSync(pfad, "utf8");
const alt = process.argv.includes("--alter-stand");
const offen = alt ? !lies("test/text.test.js").includes("leer") : lies("src/rechnen.js").includes("=== 7") && !lies("test/rechnen.test.js").includes("(7)");
const mutant = alt ? ${JSON.stringify(ALT_MUTANT)} : ${JSON.stringify(NEU_MUTANT)};
if (offen && !process.argv.includes(mutant)) process.exitCode = 1;
console.log(process.exitCode ? "Verstoß: Mutant überlebt: " + mutant : "grün: keiner überlebt");
`;
export const MIT_MUTATION = {
  "mutation.mjs": ERSATZ_MUTATION,
  "package.json": BASIS["package.json"].replace('"lint"', '"test:mutation":"node mutation.mjs","lint"'),
};
export const UMGEBAUT = { "src/text.js": "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n" };
const MIT_LEER_TEST = { "test/text.test.js": `${BASIS["test/text.test.js"]}test("leer", () => assert.equal(gross(""), ""));\n` };

export function umbauMitNachrunde(context, { drehbuch: zusatz = {}, dateien = {}, ...weiter } = {}) {
  const drehbuch = { bau: UMGEBAUT, "test-nachrunde": MIT_LEER_TEST, "test-nachrunde-antwort": ABSATZ_ALTER_STAND, ...zusatz };
  return starte(context, { auftrag: UMBAU, drehbuch, dateien: { ...MIT_MUTATION, ...dateien }, ...weiter });
}

export const MIT_SIEBEN = { "src/rechnen.js": "export function verdopple(zahl) {\n  if (zahl === 7) return 0;\n  return zahl * 2;\n}\n" };

export const PIN_MELDUNG = "Befunde bewegt: 0 -> 1  id-length: Identifier name '_' is too short (< 2).";
const ERSATZ_PIN_PRUEFUNG = `import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const dateien = process.argv.slice(2);
appendFileSync("pin-aufrufe.txt", JSON.stringify(dateien) + "\\n");
const zuViel = dateien.filter((datei) => execFileSync("git", ["show", ":" + datei], { encoding: "utf8" }).includes("const _"));
for (const datei of zuViel) console.error("[check-staged-suppressions] Commit abgebrochen:\\n  " + datei + "\\n     " + ${JSON.stringify(PIN_MELDUNG)} + "\\n[a]\\n[b]\\n[c]\\n[d]\\n[e]");
process.exitCode = zuViel.length > 0 ? 1 : 0;
`;
export const MIT_PIN_PRUEFUNG = { "scripts/check-staged-suppressions.js": ERSATZ_PIN_PRUEFUNG, ".gitignore": `${BASIS[".gitignore"]}pin-aufrufe.txt\n` };
export const MIT_UNTERSTRICH = { "src/rechnen.js": "export function verdopple(zahl) {\n  const _ = 2;\n  return zahl * _;\n}\n" };

export function pruefung(beleg, name) {
  return beleg.pruefungen.findLast((eintrag) => eintrag.name === name)?.exitCode;
}

export function namen(beleg) {
  return beleg.pruefungen.map(({ name }) => name);
}

export function rotAn(name, lauf, beleg) {
  const ergebnis = { status: lauf.status, ergebnis: beleg.ergebnis, grund: beleg.grund, exitCode: pruefung(beleg, name) };
  assert.deepEqual(ergebnis, { status: EXIT_ROT, ergebnis: "rot", grund: `${name} endete mit Exit ${EXIT_ROT}.`, exitCode: EXIT_ROT }, lauf.stdout + lauf.stderr);
}

export function exitCodes(beleg, name) {
  return beleg.pruefungen.filter((eintrag) => eintrag.name === name).map(({ exitCode }) => exitCode);
}
