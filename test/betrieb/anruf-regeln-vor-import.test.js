import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "betrieb-pruefen.mjs");
const ANRUFREGELN = path.join("docs", "betrieb", "grafana", "anrufregeln.json");
const SEITEN = path.join("docs", "betrieb", "alarme");

function kopiere(aendere) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "anruf-vor-import-"));
  fs.mkdirSync(path.join(wurzel, "docs", "betrieb", "grafana"), { recursive: true });
  const alarme = path.join("docs", "betrieb", "grafana", "alarmregeln.json");
  fs.copyFileSync(path.join(ROOT, alarme), path.join(wurzel, alarme));
  fs.cpSync(path.join(ROOT, SEITEN), path.join(wurzel, SEITEN), { recursive: true });
  const regeln = JSON.parse(fs.readFileSync(path.join(ROOT, ANRUFREGELN), "utf8"));
  aendere?.(regeln);
  fs.writeFileSync(path.join(wurzel, ANRUFREGELN), JSON.stringify(regeln));
  return wurzel;
}

function pruefe(aendere) {
  return spawnSync(process.execPath, [SKRIPT, "--wurzel", kopiere(aendere)], { encoding: "utf8" });
}

function echteRegel(uid) {
  const regeln = JSON.parse(fs.readFileSync(path.join(ROOT, ANRUFREGELN), "utf8"));
  const regel = regeln.find((eintrag) => eintrag.uid === uid);
  return regel.data.find((zeile) => zeile.refId === "A").model.expr;
}

describe("Anrufregeln vor dem Grafana-Import", () => {
  it("Annahmezeit zählt nur eingehende Anrufe", () => {
    const lauf = pruefe();
    assert.equal(lauf.status, 0, lauf.stderr);
    const expr = echteRegel("anruf-annahmezeit");
    assert.ok(expr.includes('hermes_call_answer_time_count{direction="inbound"}'));
    assert.ok(expr.includes('hermes_call_answer_time_bucket{le="5",direction="inbound"}'));
    assert.ok(!expr.includes('direction="outbound"'));
    assert.ok(!/hermes_call_answer_time_(count|bucket)(\{le="5"\})?\[/.test(expr));
  });

  it("Erfolgsquote zählt Nichtannahme und Besetzt nicht als Fehler", () => {
    const expr = echteRegel("anruf-erfolgsquote");
    assert.ok(
      expr.includes('hermes_call_ended_total{ergebnis="failed",grund!~"no-answer|busy|keiner"}'),
    );
    assert.ok(expr.includes("/ sum(increase(hermes_call_ended_total[1h]))"));
  });

  it("jede Regel behandelt fehlende Daten als in Ordnung", () => {
    const regeln = JSON.parse(fs.readFileSync(path.join(ROOT, ANRUFREGELN), "utf8"));
    assert.deepEqual(
      regeln.map((regel) => regel.noDataState),
      ["OK", "OK", "OK"],
    );
  });

  it("fehlt noDataState in einer Regel, meldet das Skript es", () => {
    const lauf = pruefe((regeln) => {
      delete regeln[1].noDataState;
    });
    assert.equal(lauf.status, 1);
    assert.equal(lauf.stderr.trim(), "anruf-annahmezeit: noDataState muss OK sein");
  });

  it("weicht expr von burnrate ab, bleibt die Meldung", () => {
    const lauf = pruefe((regeln) => {
      regeln[0].burnrate.slo = 0.95;
    });
    assert.equal(lauf.status, 1);
    assert.match(lauf.stderr, /anruf-erfolgsquote: expr weicht von burnrate ab/);
  });
});
