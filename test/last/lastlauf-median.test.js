import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const MEDIAN = fileURLToPath(new URL("../../scripts/last/median.mjs", import.meta.url));
const CI = new URL("../../.github/workflows/ci.yml", import.meta.url);

const laden = () => import("../../scripts/last/median.mjs");
const logMit = (quote, vorher = "") =>
  `2026-11-17T10:00:00.0000000Z ${vorher}\n2026-11-17T10:00:01.0000000Z ${JSON.stringify({ ergebnis: { fehlerquoteProzent: quote }, urteil: { gruen: true, gruende: [] } })}\n`;

const TABELLE = [
  ["ungerade Anzahl: mittlerer Wert", [0.4, 0.1, 0.3], { anzahl: 3, median: 0.3 }],
  ["gerade Anzahl: Mittel der beiden mittleren", [0.4, 0.1, 0.2, 0.6], { anzahl: 4, median: 0.3 }],
  ["ein Wert", [0.7], { anzahl: 1, median: 0.7 }],
  ["Nullwerte zaehlen", [0, 0, 0.5], { anzahl: 3, median: 0 }],
  ["keine Werte", [], { anzahl: 0, median: undefined }],
];

for (const [name, quoten, erwartet] of TABELLE) {
  test(`Lastlauf-Median: ${name}`, async () => {
    const { medianDerLogs } = await laden();
    assert.deepEqual(medianDerLogs(quoten.map((q) => logMit(q))), erwartet);
  });
}

test("Lastlauf-Median: nur die letzte Ergebniszeile eines Logs zaehlt, Zeilen ohne Ergebnis und kaputte Zeilen werden uebersprungen", async () => {
  const { medianDerLogs } = await laden();
  const log = `${logMit(0.9)}Lastlauf: erster Lauf Fehlerquote 0.9 %\n2026-11-17T10:00:02Z {kaputt\n${logMit(0.2)}2026-11-17T10:00:03Z fertig\n`;
  assert.deepEqual(medianDerLogs([log, "kein Ergebnis", logMit(0.4)]), { anzahl: 2, median: 0.3 });
});

test("Lastlauf-Median: ein Log ohne Zahl als Quote bleibt unberuecksichtigt", async () => {
  const { medianDerLogs } = await laden();
  const ohneZahl = `${JSON.stringify({ ergebnis: { fehlerquoteProzent: "x" } })}\n`;
  assert.deepEqual(medianDerLogs([ohneZahl, logMit(0.5)]), { anzahl: 1, median: 0.5 });
});

test("Lastlauf-Median: Ausgabezeile nennt Anzahl und Median, bei fehlenden Werten den Grund, Exit-Code bleibt 0", async () => {
  const ordner = await mkdtemp(join(tmpdir(), "hermes-median-"));
  try {
    await writeFile(join(ordner, "a.log"), logMit(0.2));
    await writeFile(join(ordner, "b.log"), logMit(0.6));
    const mit = spawnSync(process.execPath, [MEDIAN, ordner], { encoding: "utf8" });
    assert.equal(mit.status, 0);
    assert.equal(mit.stdout, "Median der Fehlerquote der letzten 2 Queue-Laeufe: 0.4 %\n");
    const leer = await mkdtemp(join(tmpdir(), "hermes-median-leer-"));
    const ohne = spawnSync(process.execPath, [MEDIAN, leer], { encoding: "utf8" });
    await rm(leer, { recursive: true, force: true });
    assert.equal(ohne.status, 0);
    assert.equal(ohne.stdout, "Median der Fehlerquote der letzten Queue-Laeufe: keine Werte vorhanden\n");
    const fehlt = spawnSync(process.execPath, [MEDIAN, join(ordner, "gibt-es-nicht")], { encoding: "utf8" });
    assert.equal(fehlt.status, 0);
    assert.equal(fehlt.stdout, "Median der Fehlerquote der letzten Queue-Laeufe: keine Werte vorhanden\n");
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
});

test("Lastlauf-Median: ci.yml ruft die Auswertung in einem Schritt auf, der den Job nie rot macht", async () => {
  const { readFileSync } = await import("node:fs");
  const ci = readFileSync(CI, "utf8");
  const job = ci.slice(ci.indexOf("\n  lastlauf:\n"), ci.indexOf("\n  codeql:\n"));
  const schritt = job.slice(job.indexOf("- name: Median"), job.indexOf("- name: Rotprobe"));
  assert.ok(schritt.length > 0, "Schritt Median fehlt");
  assert.match(schritt, /continue-on-error: true/);
  assert.match(schritt, /if: \$\{\{ !cancelled\(\) && github\.event_name == 'merge_group' \}\}/);
  assert.match(schritt, /event=merge_group/);
  assert.match(schritt, /per_page=20/);
  assert.match(schritt, /node scripts\/last\/median\.mjs/);
  assert.match(job, /permissions:\n {6}contents: read\n {6}actions: read/);
  assert.ok(job.indexOf("scripts/last/lauf.mjs k6") < job.indexOf("- name: Median"));
});
