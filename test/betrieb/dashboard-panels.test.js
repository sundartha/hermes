import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "betrieb-pruefen.mjs");
const DASHBOARD = path.join("docs", "betrieb", "grafana", "dashboard.json");
const REGELN = path.join("docs", "betrieb", "grafana", "alarmregeln.json");
const SEITEN = path.join("docs", "betrieb", "alarme");
const TELEMETRIE = path.join("src", "utils", "telemetrie.js");
const MESSUNG = path.join("src", "utils", "betriebsmessung.js");

function kopiere() {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-panels-"));
  fs.mkdirSync(path.join(wurzel, "docs", "betrieb", "grafana"), { recursive: true });
  fs.mkdirSync(path.join(wurzel, "src", "utils"), { recursive: true });
  for (const datei of [DASHBOARD, REGELN, TELEMETRIE, MESSUNG]) {
    if (!fs.existsSync(path.join(ROOT, datei))) continue;
    fs.copyFileSync(path.join(ROOT, datei), path.join(wurzel, datei));
  }
  fs.cpSync(path.join(ROOT, SEITEN), path.join(wurzel, SEITEN), { recursive: true });
  return wurzel;
}

function pruefe(wurzel) {
  return spawnSync(process.execPath, [SKRIPT, "--panels", "--wurzel", wurzel], {
    encoding: "utf8",
  });
}

describe("Dashboard und gelieferte Kennzahlen", () => {
  it("vollständiger Stand ist grün", () => {
    const lauf = pruefe(kopiere());
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  });

  it("entferntes Panel wird mit dem Kennzahl-Namen gemeldet", () => {
    const wurzel = kopiere();
    const datei = path.join(wurzel, DASHBOARD);
    const dashboard = JSON.parse(fs.readFileSync(datei, "utf8"));
    dashboard.panels = dashboard.panels.filter(
      (panel) => !JSON.stringify(panel).includes("hermes_db_pool_waiting"),
    );
    fs.writeFileSync(datei, JSON.stringify(dashboard));
    const lauf = pruefe(wurzel);
    assert.notEqual(lauf.status, 0);
    assert.match(lauf.stdout + lauf.stderr, /hermes\.db\.pool\.waiting: kein Panel/);
  });

  it("neue Kennzahl ohne Panel wird mit ihrem Namen gemeldet", () => {
    const wurzel = kopiere();
    const datei = path.join(wurzel, MESSUNG);
    const quelle = fs.readFileSync(datei, "utf8");
    fs.writeFileSync(datei, quelle.replace("});", '  neu: "hermes.neu.kennzahl",\n});'));
    const lauf = pruefe(wurzel);
    assert.notEqual(lauf.status, 0);
    assert.match(lauf.stdout + lauf.stderr, /hermes\.neu\.kennzahl: kein Panel/);
  });

  it("fehlendes Dashboard ist rot", () => {
    const wurzel = kopiere();
    fs.rmSync(path.join(wurzel, DASHBOARD), { force: true });
    const lauf = pruefe(wurzel);
    assert.notEqual(lauf.status, 0);
    assert.match(lauf.stdout + lauf.stderr, /dashboard\.json/);
  });

  it("Quellen ohne Kennzahlen sind rot", () => {
    const wurzel = kopiere();
    fs.writeFileSync(path.join(wurzel, TELEMETRIE), "");
    fs.writeFileSync(path.join(wurzel, MESSUNG), "");
    const lauf = pruefe(wurzel);
    assert.notEqual(lauf.status, 0);
    assert.match(lauf.stdout + lauf.stderr, /keine Kennzahlen/);
  });
});
