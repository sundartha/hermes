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
  fs.copyFileSync(path.join(ROOT, ANRUFREGELN), path.join(wurzel, ANRUFREGELN));
  fs.cpSync(path.join(ROOT, SEITEN), path.join(wurzel, SEITEN), { recursive: true });
  if (aendere) {
    const ziel = path.join(wurzel, ANRUFREGELN);
    fs.writeFileSync(ziel, JSON.stringify(aendere(JSON.parse(fs.readFileSync(ziel, "utf8")))));
  }
  return wurzel;
}

function lauf(argumente, aendere) {
  return spawnSync(process.execPath, [SKRIPT, "--wurzel", kopiere(aendere), ...argumente], {
    encoding: "utf8",
  });
}

function echteRegeln() {
  const ergebnis = lauf(["--regeln"]);
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  return JSON.parse(ergebnis.stdout);
}

function ausdruck(uid) {
  return echteRegeln().find((regel) => regel.uid === uid).expr;
}

function ohneNoData(regeln, stelle) {
  return regeln.map(({ noDataState, ...rest }, index) =>
    index === stelle ? rest : { noDataState, ...rest },
  );
}

function mitSlo(regeln) {
  return regeln.map((regel, index) =>
    index === 0 ? { ...regel, burnrate: { ...regel.burnrate, slo: 0.95 } } : regel,
  );
}

describe("Anrufregeln vor dem Grafana-Import", () => {
  it("Annahmezeit zählt nur eingehende Anrufe", () => {
    const ergebnis = lauf([]);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    const expr = ausdruck("anruf-annahmezeit");
    assert.ok(expr.includes('hermes_call_answer_time_count{direction="inbound"}'));
    assert.ok(expr.includes('hermes_call_answer_time_bucket{le="5",direction="inbound"}'));
    assert.ok(!expr.includes('direction="outbound"'));
    assert.ok(!/hermes_call_answer_time_(count|bucket)(\{le="5"\})?\[/.test(expr));
  });

  it("Erfolgsquote zählt Nichtannahme und Besetzt nicht als Fehler", () => {
    const expr = ausdruck("anruf-erfolgsquote");
    assert.ok(
      expr.includes('hermes_call_ended_total{ergebnis="failed",grund!~"no-answer|busy|keiner"}'),
    );
    assert.ok(expr.includes("/ sum(increase(hermes_call_ended_total[1h]))"));
  });

  it("jede Regel behandelt fehlende Daten als in Ordnung", () => {
    assert.deepEqual(
      echteRegeln().map((regel) => regel.noDataState),
      ["OK", "OK", "OK"],
    );
  });

  it("fehlt noDataState in einer Regel, meldet das Skript es", () => {
    const ergebnis = lauf([], (regeln) => ohneNoData(regeln, 1));
    assert.equal(ergebnis.status, 1);
    assert.equal(ergebnis.stderr.trim(), "anruf-annahmezeit: noDataState muss OK sein");
  });

  it("weicht expr von burnrate ab, bleibt die Meldung", () => {
    const ergebnis = lauf([], mitSlo);
    assert.equal(ergebnis.status, 1);
    assert.equal(ergebnis.stderr.trim(), "anruf-erfolgsquote: expr weicht von burnrate ab");
  });
});
