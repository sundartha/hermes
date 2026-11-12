import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "betrieb-pruefen.mjs");
const REGELN = path.join("docs", "betrieb", "grafana", "alarmregeln.json");
const SEITEN = path.join("docs", "betrieb", "alarme");

function kopiere() {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "alarmanleitungen-"));
  fs.mkdirSync(path.join(wurzel, "docs", "betrieb", "grafana"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, REGELN), path.join(wurzel, REGELN));
  fs.cpSync(path.join(ROOT, SEITEN), path.join(wurzel, SEITEN), { recursive: true });
  return wurzel;
}

function pruefe(wurzel) {
  return spawnSync(process.execPath, [SKRIPT, "--wurzel", wurzel], { encoding: "utf8" });
}

describe("Alarmregeln und Anleitungen", () => {
  it("vollständiger Stand ist grün", () => {
    const wurzel = kopiere();
    const lauf = pruefe(wurzel);
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    const regeln = JSON.parse(fs.readFileSync(path.join(wurzel, REGELN), "utf8"));
    assert.deepEqual(
      regeln.map((regel) => regel.uid),
      ["http-dauer-p95", "eventloop-p99", "db-pool-wartend", "anbieter-fehlerquote"],
    );
  });

  it("Regel ohne Seite wird gemeldet", () => {
    const wurzel = kopiere();
    fs.rmSync(path.join(wurzel, SEITEN, "db-pool-wartend.md"));
    const lauf = pruefe(wurzel);
    assert.notEqual(lauf.status, 0);
    assert.match(lauf.stdout + lauf.stderr, /db-pool-wartend/);
  });

  it("Seite ohne Abschnitt Eskalieren wird gemeldet", () => {
    const wurzel = kopiere();
    const seite = path.join(wurzel, SEITEN, "eventloop-p99.md");
    fs.writeFileSync(seite, fs.readFileSync(seite, "utf8").replace("## Eskalieren", "## Weiter"));
    const lauf = pruefe(wurzel);
    assert.notEqual(lauf.status, 0);
    const ausgabe = lauf.stdout + lauf.stderr;
    assert.match(ausgabe, /eventloop-p99/);
    assert.match(ausgabe, /Eskalieren/);
  });

  it("Regel mit fremdem runbook_url wird gemeldet", () => {
    const wurzel = kopiere();
    const datei = path.join(wurzel, REGELN);
    const regeln = JSON.parse(fs.readFileSync(datei, "utf8"));
    regeln[0].annotations.runbook_url = "docs/betrieb/alarme/anderes.md";
    fs.writeFileSync(datei, JSON.stringify(regeln));
    const lauf = pruefe(wurzel);
    assert.notEqual(lauf.status, 0);
    assert.match(lauf.stdout + lauf.stderr, /http-dauer-p95/);
  });
});
