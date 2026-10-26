import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fortschrittFaellig, hochrechnung } from "../../tools/mutationspruefung/zeitlog.mjs";
import { probeDirectory, REPO_ROOT, runIn } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const MINUTE_MS = 60_000;

function eintrag(art, ms, daten = {}) {
  return { art, zeit: "2026-10-26T17:00:00.000Z", ms_seit_start: ms, ...daten };
}

const MUTATIONSLAUF_EINTRAG = { datei: "src/a.js", anlass: "erster Lauf", mutanten: 10, ms_sandbox: 2000, ms_erstlauf: 1000, ms_mutanten: 4000 };
const LAUF = [
  eintrag("start", 0, { betriebsart: "normal", basis: "HEAD", commit: "abc" }),
  eintrag("sperre", 1000, { ms: 1000 }),
  eintrag("testauswahl", 2000, { ms: 1000, dateien: 1, testdateien: 3 }),
  eintrag("stryker", 9000, MUTATIONSLAUF_EINTRAG),
  eintrag("loeschprobe", 10_000, { datei: "src/a.js", ms: 1000 }),
];

function werteAus(context, eintraege) {
  const datei = join(probeDirectory(context, {}), "lauf.jsonl");
  writeFileSync(datei, `${eintraege.map((zeile) => JSON.stringify(zeile)).join("\n")}\n`);
  const lauf = runIn(probeDirectory(context, {}), process.execPath, [WERKZEUG, "--log-auswertung", datei]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return lauf.stdout.split("\n");
}

function zeile(zeilen, ...teile) {
  const treffer = zeilen.filter((text) => teile.every((teil) => text.includes(teil)));
  assert.equal(treffer.length, 1, `${teile.join(" ")}\n${zeilen.join("\n")}`);
  return treffer[0].trim().split(/\s{2,}/);
}

test("die Log-Auswertung druckt je Phase und Datei Dauer und Anteil an der Gesamtdauer und die gemessene Rate der Mutantenläufe", (context) => {
  const zeilen = werteAus(context, [...LAUF, eintrag("ende", 10_000, { ms: 10_000, exit: 0 })]);
  assert.deepEqual(zeile(zeilen, "Sperre"), ["Sperre", "-", "1,0 s", "10 %"]);
  assert.deepEqual(zeile(zeilen, "Testauswahl"), ["Testauswahl", "-", "1,0 s", "10 %"]);
  assert.deepEqual(zeile(zeilen, "Sandbox", "src/a.js"), ["Sandbox", "src/a.js", "2,0 s", "20 %"]);
  assert.deepEqual(zeile(zeilen, "Erstlauf", "src/a.js"), ["Erstlauf", "src/a.js", "1,0 s", "10 %"]);
  assert.deepEqual(zeile(zeilen, "Mutantenläufe", "src/a.js"), ["Mutantenläufe", "src/a.js", "4,0 s", "40 %"]);
  assert.deepEqual(zeile(zeilen, "Löschprobe", "src/a.js"), ["Löschprobe", "src/a.js", "1,0 s", "10 %"]);
  assert.deepEqual(zeile(zeilen, "Gesamt"), ["Gesamt", "-", "10,0 s", "100 %"]);
  assert.match(zeilen.join("\n"), /150,0 Mutanten je Minute/);
});

test("die Log-Auswertung eines abgebrochenen Laufs ohne Ende-Eintrag rechnet bis zum letzten Eintrag und sagt das", (context) => {
  const zeilen = werteAus(context, LAUF);
  assert.deepEqual(zeile(zeilen, "Gesamt"), ["Gesamt", "-", "10,0 s", "100 %"]);
  assert.deepEqual(zeile(zeilen, "Mutantenläufe", "src/a.js"), ["Mutantenläufe", "src/a.js", "4,0 s", "40 %"]);
  assert.match(zeilen.join("\n"), /ohne Ende-Eintrag/);
});

test("eine Fortschrittszeile ist erst 30 s nach der letzten fällig", () => {
  const faelle = [
    [{ letzte: 0, jetzt: 29_999 }, false],
    [{ letzte: 0, jetzt: 30_000 }, true],
    [{ letzte: 50_000, jetzt: 70_000 }, false],
    [{ letzte: 50_000, jetzt: 90_000 }, true],
  ];
  for (const [eingabe, erwartet] of faelle) assert.equal(fortschrittFaellig(eingabe), erwartet, JSON.stringify(eingabe));
});

test("die Hochrechnung der Restzeit folgt der gemessenen Rate dieses Laufs", () => {
  const faelle = [
    [{ getestet: 120, geplant: 410, ms: 14 * MINUTE_MS }, { jeMinute: 120 / 14, restMs: 2_030_000 }],
    [{ getestet: 10, geplant: 10, ms: MINUTE_MS }, { jeMinute: 10, restMs: 0 }],
    [{ getestet: 0, geplant: 10, ms: MINUTE_MS }, { jeMinute: 0, restMs: null }],
  ];
  for (const [eingabe, erwartet] of faelle) assert.deepEqual(hochrechnung(eingabe), erwartet, JSON.stringify(eingabe));
});
