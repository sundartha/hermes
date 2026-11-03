import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";

import { fuehreAusMitFortschritt } from "../../tools/auftrag/fortschritt.mjs";
import { probeDirectory } from "./probe-repo.js";

const EXIT_ABBRUCH = 2;
const KIND_LAEUFT_NOCH_MS = 1500;
const MINDESTABSTAND_ZEILE_ZU_ENDE_MS = 1000;
const KURZER_TAKT_MS = 50;
const ARBEITER_DARF_NICHT_ANLAUFEN_MS = 200;
const KIND = [
  'import { appendFileSync } from "node:fs";',
  'appendFileSync(process.env.HERMES_FORTSCHRITT_DATEI, "Fortschritt: eins\\n");',
  `await new Promise((fertig) => setTimeout(fertig, ${KIND_LAEUFT_NOCH_MS}));`,
  'console.log("fertig");',
  'console.error("Abbruch: Probe");',
  `process.exitCode = ${EXIT_ABBRUCH};`,
  "",
].join("\n");

test("Fortschritt aus dem Kindprozess erscheint, während der Befehl noch läuft, und der Befehl liefert Ausgabe und Exit wie sonst", (context) => {
  const ordner = probeDirectory(context, {});
  const datei = join(ordner, "kind.mjs");
  writeFileSync(datei, KIND);
  const gezeigt = [];
  const ergebnis = fuehreAusMitFortschritt("probe", [process.execPath, datei], { cwd: ordner, env, zeige: (zeile) => gezeigt.push({ zeile, zeit: Date.now() }), taktMs: KURZER_TAKT_MS });
  const ende = Date.now();
  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  assert.match(ergebnis.ausgabe, /fertig/);
  assert.match(ergebnis.ausgabe, /Abbruch: Probe/);
  assert.deepEqual(gezeigt.map(({ zeile }) => zeile), ["Fortschritt: eins"]);
  assert.ok(ende - gezeigt[0].zeit >= MINDESTABSTAND_ZEILE_ZU_ENDE_MS, `${ende - gezeigt[0].zeit} ms zwischen Zeile und Ende`);
});

test("ohne eigene Umgebung erbt der Befehl die des Prozesses und bekommt zusätzlich die Datei für Fortschrittszeilen", (context) => {
  const ordner = probeDirectory(context, {});
  const abfrage = 'console.log(`PATH:${process.env.PATH === undefined ? "fehlt" : "da"} DATEI:${process.env.HERMES_FORTSCHRITT_DATEI === undefined ? "fehlt" : "da"}`);';
  const ergebnis = fuehreAusMitFortschritt("probe", [process.execPath, "-e", abfrage], { cwd: ordner, zeige: () => {} });
  assert.equal(ergebnis.exitCode, 0);
  assert.match(ergebnis.ausgabe, /PATH:da DATEI:da/);
});

test("läuft der Arbeiter für die Fortschrittszeilen nicht an, endet das Warten mit einem Fehler statt endlos", (context) => {
  const ordner = probeDirectory(context, {});
  const ohneStart = join(ordner, "ohne-start.mjs");
  writeFileSync(ohneStart, "");
  const start = Date.now();
  assert.throws(() => fuehreAusMitFortschritt("probe", [process.execPath, "-e", "0"], { cwd: ordner, arbeiter: ohneStart, anlaufMs: ARBEITER_DARF_NICHT_ANLAUFEN_MS, taktMs: KURZER_TAKT_MS }), /nicht angelaufen/);
  assert.ok(Date.now() - start < KIND_LAEUFT_NOCH_MS * 4);
});
