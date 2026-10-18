import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { BASIS, EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

export const ZEILEN_UEBER_GRENZE = 401;
export const GELOESCHTE_ZEILEN = 360;
export const NEUE_ZEILEN = 50;
export const ANTWORTEN_JE_SITZUNG = 2;
const NIE = { wiederholung: "-", gleichzeitig: "-", zeitueberschreitung: "-", abbruch: "-" };
export const ABSATZ_ROT = "Zweck rot: Drehbuchtext des Ersatz-Agenten.";
export const ABSATZ_MUTATION = "Zweck mutation: Drehbuchtext des Ersatz-Agenten.";
export const ABSATZ_ALTER_STAND = "Zweck mutation alter Stand: Drehbuchtext des Ersatz-Agenten.";
export const ABSATZ_PIN = "Zweck pin-prüfung: Drehbuchtext des Ersatz-Agenten.";

export const ROTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdopple } from "../src/rechnen.js";',
  'test("verdoppelt", () => assert.equal(verdopple(2), 4));',
  "",
].join("\n");

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

export const NEU_MUTANT = "src/rechnen.js:2:7 ConditionalExpression → false";
export const ALT_MUTANT = "src/text.js:2:10 MethodExpression → text";
export const GLEICHWERTIG_MIT_GRUND = `Gleichwertig: ${NEU_MUTANT}, weil die Sieben ohne Sonderfall dasselbe Ergebnis hätte`;
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
export const MIT_SIEBEN = { "src/rechnen.js": "export function verdopple(zahl) {\n  if (zahl === 7) return 0;\n  return zahl * 2;\n}\n" };
export const SIEBEN_TEST = `${ROTER_TEST}test("sieben", () => assert.equal(verdopple(7), 0));\n`;

export function pruefung(beleg, name) {
  return beleg.pruefungen.findLast((eintrag) => eintrag.name === name)?.exitCode;
}

export function exitCodes(beleg, name) {
  return beleg.pruefungen.filter((eintrag) => eintrag.name === name).map(({ exitCode }) => exitCode);
}

const PATCH = ".git/auftrag-umbau/probe/A1.patch";
export const NOETIG_GRUND = "eine Sieben sonst verdoppelt würde";
export const NOETIG = `Nötig: ${NEU_MUTANT}, weil ${NOETIG_GRUND}`;
export const PASST_NICHT = "Auftrag passt nicht: Die Zeile ist nötig, nur der Test fehlt.";

export function ehrlicheNachrunde(antwort) {
  return { "bau-nachrunde-antwort": { "Nötig: <Mutant>": antwort, "": PASST_NICHT } };
}

export function mitSieben(context, zusatz) {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN, ...zusatz };
  return starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_MUTATION });
}

export function pruefeGesichert({ repo, beleg }) {
  assert.equal(beleg.patch, join(realpathSync(repo), PATCH));
  assert.match(readFileSync(join(repo, PATCH), "utf8"), /^\+ {2}if \(zahl === 7\) return 0;$/m);
}

export const PIN_MELDUNG = "Befunde bewegt: 0 -> 1  id-length: Identifier name '_' is too short (< 2).";
const ERSATZ_PIN_PRUEFUNG = `import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const dateien = process.argv.slice(2);
appendFileSync("pin-aufrufe.txt", JSON.stringify(dateien) + "\\n");
const zuViel = dateien.filter((datei) => execFileSync("git", ["show", ":" + datei], { encoding: "utf8" }).includes("const _"));
for (const datei of zuViel) console.error("[check-staged-suppressions] Commit abgebrochen:\\n  " + datei + "\\n     " + ${JSON.stringify(PIN_MELDUNG)} + "\\n[a]\\n[b]\\n[c]\\n[d]\\n[e]");
process.exitCode = zuViel.length > 0 ? 1 : 0;
`;
export const MIT_PIN_PRUEFUNG = { ...MIT_MUTATION, "scripts/check-staged-suppressions.js": ERSATZ_PIN_PRUEFUNG, ".gitignore": `${BASIS[".gitignore"]}pin-aufrufe.txt\n` };
export const MIT_UNTERSTRICH = { "src/rechnen.js": "export function verdopple(zahl) {\n  const _ = 2;\n  return zahl * _;\n}\n" };

export function scheitertAnPinPruefung(lauf, beleg) {
  const nachLint = beleg.pruefungen[beleg.pruefungen.findIndex(({ name }) => name === "lint") + 1];
  const ergebnis = { status: lauf.status, nachLint: nachLint?.name, exitCode: nachLint?.exitCode, grund: beleg.grund };
  assert.deepEqual(ergebnis, { status: EXIT_ROT, nachLint: "pin-prüfung", exitCode: EXIT_ROT, grund: `pin-prüfung endete mit Exit ${EXIT_ROT}.` }, lauf.stdout + lauf.stderr);
}
