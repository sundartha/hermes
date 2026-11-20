import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");

function schrittBlock(name) {
  const start = WORKFLOW.indexOf(`- name: ${name}`);
  assert.ok(start >= 0);
  const ende = WORKFLOW.indexOf("\n      - name:", start + 1);
  return WORKFLOW.slice(start, ende);
}

function heartbeatLaeuft({ ereignis, pruefung, probe, monatspruefung }) {
  const zeile = schrittBlock("Heartbeat Nachtlauf").match(/\n {8}if: (.+)\n/);
  assert.ok(zeile);
  const ergebnisse = { pruefung, probe, monatspruefung };
  const steps = {};
  for (const [kennung, ergebnis] of Object.entries(ergebnisse)) steps[kennung] = { outcome: ergebnis };
  const vorherRot = Object.values(ergebnisse).some((ergebnis) => ergebnis === "failure");
  const ausdruck = zeile[1].replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  const auswerten = new Function("steps", "success", "always", "github", `return (${ausdruck});`);
  return auswerten(steps, () => !vorherRot, () => true, { event_name: ereignis });
}

const ID_PRUEFUNG = /- name: Staging abwarten und prüfen[^\n]*\n(?: {8}[^\n]*\n)*? {8}id: pruefung\n/;

test("Nachtlauf-Heartbeat: Prüfung grün, Anrufprobe rot im Zeitplan sendet den Heartbeat", () => {
  assert.match(WORKFLOW, ID_PRUEFUNG);
  assert.equal(heartbeatLaeuft({ ereignis: "schedule", pruefung: "success", probe: "failure", monatspruefung: "skipped" }), true);
});

test("Nachtlauf-Heartbeat: rote Staging-Prüfung im Zeitplan sendet keinen Heartbeat", () => {
  assert.equal(heartbeatLaeuft({ ereignis: "schedule", pruefung: "failure", probe: "skipped", monatspruefung: "skipped" }), false);
});

test("Nachtlauf-Heartbeat: außerhalb des Zeitplans läuft er nie", () => {
  for (const ereignis of ["push", "workflow_dispatch"]) {
    assert.equal(heartbeatLaeuft({ ereignis, pruefung: "success", probe: "success", monatspruefung: "success" }), false);
  }
});

test("Nachtlauf-Heartbeat: rote Prüfung der Prüfung im Zeitplan sendet keinen Heartbeat", () => {
  assert.match(WORKFLOW, /- name: Prüfung der Prüfung \(monatlich\)\n(?: {8}[^\n]*\n)*? {8}id: monatspruefung\n/);
  assert.equal(heartbeatLaeuft({ ereignis: "schedule", pruefung: "success", probe: "success", monatspruefung: "failure" }), false);
});

test("Nachtlauf-Heartbeat: grüner Zeitplan-Lauf sendet ihn, die Probe-Schritte bleiben an success()", () => {
  assert.equal(heartbeatLaeuft({ ereignis: "schedule", pruefung: "success", probe: "success", monatspruefung: "success" }), true);
  assert.match(schrittBlock("Lebenszeichen Anrufprobe"), /if: success\(\) && github\.event_name == 'schedule'/);
  assert.match(schrittBlock("Prüfung der Prüfung (monatlich)"), /if: success\(\) && github\.event_name == 'schedule'/);
});

test("Nachtlauf-Heartbeat: Schritt ruft den Heartbeat Nachtlauf auf und steht vor lastlauf", () => {
  assert.match(schrittBlock("Heartbeat Nachtlauf"), /run: node tools\/deploy-weg\.mjs heartbeat --name nachtlauf\s*$/);
  assert.ok(WORKFLOW.indexOf("- name: Heartbeat Nachtlauf") < WORKFLOW.indexOf("\n  lastlauf:\n"));
  assert.equal(WORKFLOW.match(/BETTER_STACK_HEARTBEAT_NACHTLAUF/g).length, 2);
});
