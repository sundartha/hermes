import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");

function schritt(name) {
  const start = WORKFLOW.indexOf(`- name: ${name}`);
  assert.ok(start > 0, name);
  const ende = WORKFLOW.indexOf("\n      - name:", start);
  return WORKFLOW.slice(start, ende);
}

function bedingung(name) {
  return schritt(name).match(/\n {8}if: (.+)\n/)[1];
}

function laeuft({ ereignis, pruefung, probe, monat }) {
  const ausgang = { pruefung, probe };
  const vorher = [pruefung, probe, monat];
  const ohneAlways = bedingung("Heartbeat Nachtlauf").replace(/always\(\)/g, "true");
  const ohneSuccess = ohneAlways.replace(/success\(\)/g, String(!vorher.includes("failure")));
  const mitEreignis = ohneSuccess.replace(/github\.event_name/g, JSON.stringify(ereignis));
  const ausdruck = mitEreignis.replace(/steps\.(\w+)\.outcome/g, (_, id) => JSON.stringify(ausgang[id] ?? "skipped"));
  return Function(`return (${ausdruck});`)();
}

test("Heartbeat Nachtlauf läuft im Zeitplan bei grüner Prüfung auch bei roter Anrufprobe", () => {
  assert.equal(laeuft({ ereignis: "schedule", pruefung: "success", probe: "failure", monat: "skipped" }), true);
  assert.equal(laeuft({ ereignis: "schedule", pruefung: "success", probe: "success", monat: "success" }), true);
  assert.equal(laeuft({ ereignis: "schedule", pruefung: "success", probe: "success", monat: "skipped" }), true);
  assert.match(schritt("Heartbeat Nachtlauf"), /run: node tools\/deploy-weg\.mjs heartbeat --name nachtlauf\n/);
});

test("Heartbeat Nachtlauf läuft nicht bei roter Staging-Prüfung", () => {
  assert.equal(laeuft({ ereignis: "schedule", pruefung: "failure", probe: "skipped", monat: "skipped" }), false);
});

test("Heartbeat Nachtlauf läuft außerhalb des Zeitplans nie", () => {
  for (const ereignis of ["push", "workflow_dispatch"]) {
    assert.equal(laeuft({ ereignis, pruefung: "success", probe: "success", monat: "success" }), false);
  }
});

test("Heartbeat Nachtlauf läuft nicht bei roter Prüfung der Prüfung", () => {
  assert.equal(laeuft({ ereignis: "schedule", pruefung: "success", probe: "success", monat: "failure" }), false);
});

test("Die Bedingung hängt an der Kennung des Prüfschritts", () => {
  assert.match(schritt("Staging abwarten und prüfen (Proben in tools/deploy-weg/staging.mjs)"), /\n {8}id: pruefung\n/);
});

test("Lebenszeichen Anrufprobe und Prüfung der Prüfung laufen weiter nur bei success()", () => {
  assert.match(bedingung("Lebenszeichen Anrufprobe"), /^success\(\) && /);
  assert.equal(bedingung("Prüfung der Prüfung (monatlich)"), "success() && github.event_name == 'schedule'");
});
