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
const TELEMETRIE = path.join("src", "utils", "telemetrie.js");

function lauf(ausdruecke, kennzahlen) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "panel-token-"));
  fs.mkdirSync(path.join(wurzel, "docs", "betrieb", "grafana"), { recursive: true });
  fs.mkdirSync(path.join(wurzel, "src", "utils"), { recursive: true });
  const panels = ausdruecke.map((expr) => ({ targets: [{ expr }] }));
  fs.writeFileSync(path.join(wurzel, DASHBOARD), JSON.stringify({ panels }));
  fs.writeFileSync(path.join(wurzel, REGELN), "[]");
  fs.writeFileSync(
    path.join(wurzel, TELEMETRIE),
    kennzahlen.map((name, i) => `export const k${i} = "${name}";\n`).join(""),
  );
  fs.writeFileSync(path.join(wurzel, "src", "utils", "betriebsmessung.js"), "");
  const ergebnis = spawnSync(process.execPath, [SKRIPT, "--panels", "--wurzel", wurzel], {
    encoding: "utf8",
  });
  return { status: ergebnis.status, text: ergebnis.stdout + ergebnis.stderr };
}

describe("Panel deckt eine Kennzahl nur als ganzes Metrik-Token", () => {
  it("Präfix-Kennzahl wird nicht von der längeren gedeckt", () => {
    const ergebnis = lauf(["max(hermes_db_pool_open)"], ["hermes.db.pool", "hermes.db.pool.open"]);
    assert.notEqual(ergebnis.status, 0);
    assert.match(ergebnis.text, /hermes\.db\.pool: kein Panel/);
    assert.doesNotMatch(ergebnis.text, /hermes\.db\.pool\.open: kein Panel/);
  });

  for (const expr of [
    "hermes_x",
    'hermes_x{a="b"}',
    "rate(hermes_x[5m])",
    "sum(hermes_x)",
    "a / hermes_x",
    "hermes_xy + hermes_x",
    "hermes_x_sumx + hermes_x_sum",
    "hermes_x_bucket",
    "hermes_x_sum",
    "hermes_x_count",
    "hermes_x_total",
  ]) {
    it(`deckt: ${expr}`, () => {
      const ergebnis = lauf([expr], ["hermes.x"]);
      assert.equal(ergebnis.status, 0, ergebnis.text);
    });
  }

  for (const expr of [
    "hermes_x_open",
    "hermes_xy",
    "hermes_x_totals",
    "xhermes_x",
    "hermes_xy + hermes_x_sumx",
  ]) {
    it(`deckt nicht: ${expr}`, () => {
      const ergebnis = lauf([expr], ["hermes.x"]);
      assert.notEqual(ergebnis.status, 0);
      assert.match(ergebnis.text, /hermes\.x: kein Panel/);
    });
  }
});
