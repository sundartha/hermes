import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { ausklingBefunde, grenzeAbleiten } from "../../tools/testlaufzeit/ausklingen.mjs";
import { aufrufeIn, echtWartenBefunde } from "../../tools/testlaufzeit/echt-warten-statisch.mjs";
import { REPO_ROOT, isolatedEnvironment } from "./probe-repo.js";

const REPORTER = join(REPO_ROOT, "tools/testlaufzeit-reporter.mjs");
const KIND_SCHLAEFT_S = 3;
const KIND_UNTERGRENZE_MS = 2500;
const SCHNELL_OBERGRENZE_MS = 1000;
const LAUF_FRIST_MS = 60_000;
const ABGELEITETE_GRENZE_MS = 77.3;
const OBERGRENZE_PLUS_EINS = 101;
const KURZE_SPITZE_MS = 400;
const NACHMESSUNG_GRUEN_MS = 20;
const NACHMESSUNG_ROT_MS = 390;

const KURZ_WARTEN_MS = 30;
const ZWEI_AUFRUFE = 2;
const ECHT_WARTEN = join(REPO_ROOT, "test/echt-warten.js");

const SCHNELLE_DATEI = ['import { test } from "node:test";', 'test("schnell", () => {});'];
const KIND_DATEI = [
  'import { spawn } from "node:child_process";',
  'import { test } from "node:test";',
  'test("erster", () => {});',
  `test("letzter startet einen Kindprozess", () => { spawn("sleep", ["${KIND_SCHLAEFT_S}"]); });`,
];

function lauf(context, dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "testlaufzeit-"));
  context.after(() => rmSync(ordner, { recursive: true, force: true }));
  for (const [name, zeilen] of Object.entries(dateien)) {
    writeFileSync(join(ordner, name), `${zeilen.join("\n")}\n`);
  }
  const ziel = join(ordner, "dateien.jsonl");
  const ergebnis = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=2",
      `--test-reporter=${REPORTER}`,
      `--test-reporter-destination=${ziel}`,
      ...Object.keys(dateien),
    ],
    { cwd: ordner, env: isolatedEnvironment(), timeout: LAUF_FRIST_MS },
  );
  assert.equal(ergebnis.status, 0, String(ergebnis.stderr));
  const zeilen = readFileSync(ziel, "utf8")
    .trim()
    .split("\n")
    .map((zeile) => JSON.parse(zeile));
  return new Map(zeilen.map((zeile) => [zeile.datei, zeile]));
}

test("der Reporter misst die Ausklingzeit eines nicht abgewarteten Kindprozesses, auch neben anderen Dateien", (context) => {
  const gemessen = lauf(context, {
    "a-kind.test.js": KIND_DATEI,
    "b-schnell.test.js": SCHNELLE_DATEI,
  });
  assert.ok(gemessen.get("a-kind.test.js").ausklingen_ms >= KIND_UNTERGRENZE_MS);
  assert.ok(gemessen.get("b-schnell.test.js").ausklingen_ms < SCHNELL_OBERGRENZE_MS);
  assert.ok(gemessen.get("b-schnell.test.js").dauer_ms > 0);
});

function laufMit(werte) {
  return Object.entries(werte).map(([datei, ausklingen]) => ({ datei, ausklingen_ms: ausklingen }));
}

const UNTERE_GRUPPE = { eins: 1, zwei: 2, drei: 3, zehn: 10, zwanzig: 20, dreissig: 30 };

test("die Grenze liegt in der Mitte der größten Lücke, und es zählt der Höchstwert je Datei", () => {
  const erster = laufMit({ ...UNTERE_GRUPPE, langsam: 199, sehrLangsam: 400 });
  const zweiter = laufMit({ ...UNTERE_GRUPPE, dreissig: 25, langsam: 150, sehrLangsam: 390 });
  const ergebnis = grenzeAbleiten([erster, zweiter]);
  assert.equal(ergebnis.ausklingen_grenze_ms, ABGELEITETE_GRENZE_MS);
  assert.deepEqual(ergebnis.ausklingen_bestand, ["langsam", "sehrLangsam"]);
});

test("ohne Lücke von mindestens Faktor 4 gibt es keine Grenze, nur den Bericht", () => {
  const gleichmaessig = laufMit({ eins: 10, zwei: 20, drei: 40, vier: 80, fuenf: 160, sechs: 320 });
  const ergebnis = grenzeAbleiten([gleichmaessig]);
  assert.equal(ergebnis.ausklingen_grenze_ms, null);
  assert.deepEqual(ergebnis.ausklingen_bestand, []);
});

const BASIS = { ausklingen_grenze_ms: 77, ausklingen_bestand: ["test/bekannt.test.js"] };

test("eine Datei nur in der ersten Messung über der Grenze ist grün, in beiden Messungen rot", () => {
  const zeilen = [{ datei: "test/werkzeuge/testlaufzeit.test.js", ausklingen_ms: 400 }];
  assert.deepEqual(
    ausklingBefunde(zeilen, { ...BASIS, ausklingen_bestand: [] }, () => NACHMESSUNG_GRUEN_MS),
    [],
  );
  const rot = ausklingBefunde(
    zeilen,
    { ...BASIS, ausklingen_bestand: [] },
    () => NACHMESSUNG_ROT_MS,
  );
  assert.equal(rot.length, 1);
  assert.match(rot[0], /Ausklingzeit 400 ms über der Grenze 77 ms/);
});

test("eine eingefrorene Datei bleibt grün, ein Eintrag für eine verschobene Datei ist rot", () => {
  const zeilen = [{ datei: "test/werkzeuge/testlaufzeit.test.js", ausklingen_ms: 400 }];
  const basis = {
    ausklingen_grenze_ms: 77,
    ausklingen_bestand: ["test/werkzeuge/testlaufzeit.test.js"],
  };
  assert.deepEqual(
    ausklingBefunde(zeilen, basis, () => KURZE_SPITZE_MS),
    [],
  );
  const verschoben = ausklingBefunde(zeilen, BASIS, () => KURZE_SPITZE_MS);
  assert.ok(
    verschoben.some((befund) => befund.includes("test/bekannt.test.js gibt es nicht mehr")),
  );
});

test("ohne Grenze wird die Ausklingzeit nur berichtet", () => {
  const zeilen = [{ datei: "test/werkzeuge/testlaufzeit.test.js", ausklingen_ms: 4000 }];
  assert.deepEqual(
    ausklingBefunde(zeilen, { ausklingen_grenze_ms: null, ausklingen_bestand: [] }),
    [],
  );
});

function befundeFuer(zeilen, eintraege = []) {
  const aufrufe = aufrufeIn("test/probe.test.js", zeilen.join("\n"));
  return echtWartenBefunde(aufrufe, eintraege);
}

const IMPORT = 'import { echtWarten } from "./echt-warten.js";';
const EINTRAG_500 = {
  datei: "test/probe.test.js",
  argument: "WARTE_MS",
  hoechstwert_ms: 500,
  grund: "Probe",
};

test("echtWarten mit einer Zahl oder Konstanten bis 100 ms braucht keinen Eintrag", () => {
  const zeilen = [
    IMPORT,
    "const BASIS_MS = 40;",
    "const WARTE_MS = BASIS_MS + 10;",
    "await echtWarten(WARTE_MS);",
    "await echtWarten(100);",
  ];
  assert.deepEqual(befundeFuer(zeilen), []);
});

test("echtWarten über 100 ms ist ohne Eintrag rot und mit passendem Eintrag grün", () => {
  const zeilen = [IMPORT, "const WARTE_MS = 500;", "await echtWarten(WARTE_MS);"];
  assert.equal(befundeFuer(zeilen).length, 1);
  assert.deepEqual(befundeFuer(zeilen, [EINTRAG_500]), []);
  assert.equal(befundeFuer([IMPORT, `await echtWarten(${OBERGRENZE_PLUS_EINS});`]).length, 1);
});

test("echtWarten mit nicht bestimmbarem Argument ist ohne Eintrag rot", () => {
  const zeilen = [IMPORT, "export async function warte(ms) {", "  await echtWarten(ms);", "}"];
  assert.match(befundeFuer(zeilen)[0], /Wert nicht bestimmbar/);
});

test("ein Wert über dem Höchstwert seines Eintrags ist rot, ebenso ein verwaister Eintrag", () => {
  const zuHoch = befundeFuer(
    [IMPORT, "const WARTE_MS = 600;", "await echtWarten(WARTE_MS);"],
    [EINTRAG_500],
  );
  assert.match(zuHoch[0], /über dem Höchstwert 500 ms/);
  const verwaist = befundeFuer([IMPORT, "await echtWarten(50);"], [EINTRAG_500]);
  assert.match(verwaist[0], /passt zu keinem Aufruf/);
});

test("echtWarten lässt echte Zeit verstreichen", async () => {
  const start = performance.now();
  await echtWarten(KURZ_WARTEN_MS);
  assert.ok(performance.now() - start >= KURZ_WARTEN_MS - 1);
});

test("echtWarten schreibt Zahl und Summe der Aufrufe in die Testkosten-Datei", (context) => {
  const ordner = mkdtempSync(join(tmpdir(), "testkosten-"));
  context.after(() => rmSync(ordner, { recursive: true, force: true }));
  const kosten = join(ordner, "kosten.jsonl");
  const skript = `const { echtWarten } = await import(${JSON.stringify(ECHT_WARTEN)}); await echtWarten(${KURZ_WARTEN_MS}); await echtWarten(${KURZ_WARTEN_MS});`;
  const lauf = spawnSync(process.execPath, ["--input-type=module", "--eval", skript], {
    env: { ...isolatedEnvironment(), TESTKOSTEN_DATEI: kosten },
    timeout: LAUF_FRIST_MS,
  });
  assert.equal(lauf.status, 0, String(lauf.stderr));
  const [zeile] = readFileSync(kosten, "utf8")
    .trim()
    .split("\n")
    .map((text) => JSON.parse(text));
  assert.deepEqual(
    { art: zeile.art, anzahl: zeile.anzahl, summe: zeile.summe },
    { art: "echtWarten", anzahl: ZWEI_AUFRUFE, summe: ZWEI_AUFRUFE * KURZ_WARTEN_MS },
  );
});
