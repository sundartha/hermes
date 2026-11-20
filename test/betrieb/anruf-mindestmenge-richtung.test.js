import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "betrieb-pruefen.mjs");
const GRAFANA = path.join("docs", "betrieb", "grafana");
const SEITEN = path.join("docs", "betrieb", "alarme");

function kopiere(aendere = (regeln) => regeln) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "anruf-menge-"));
  fs.mkdirSync(path.join(wurzel, GRAFANA), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, GRAFANA, "alarmregeln.json"),
    path.join(wurzel, GRAFANA, "alarmregeln.json"),
  );
  const regeln = JSON.parse(fs.readFileSync(path.join(ROOT, GRAFANA, "anrufregeln.json"), "utf8"));
  fs.writeFileSync(
    path.join(wurzel, GRAFANA, "anrufregeln.json"),
    JSON.stringify(aendere(regeln)),
  );
  fs.cpSync(path.join(ROOT, SEITEN), path.join(wurzel, SEITEN), { recursive: true });
  return wurzel;
}

function lauf(wurzel, ...args) {
  return spawnSync(process.execPath, [SKRIPT, "--wurzel", wurzel, ...args], { encoding: "utf8" });
}

function ausdruecke() {
  const ausgabe = lauf(kopiere(), "--regeln");
  assert.equal(ausgabe.status, 0, ausgabe.stderr);
  return Object.fromEntries(JSON.parse(ausgabe.stdout).map((regel) => [regel.uid, regel.expr]));
}

describe("Mindestmenge der Anrufregeln nach Richtung", () => {
  it("Annahmezeit zählt als Mindestmenge nur eingehende Anrufe", () => {
    const expr = ausdruecke()["anruf-annahmezeit"];
    assert.ok(
      expr.includes('sum(increase(hermes_call_started_total{direction="inbound"}[1h])) >= 20'),
    );
    assert.ok(
      expr.includes('sum(increase(hermes_call_started_total{direction="inbound"}[6h])) >= 20'),
    );
    assert.ok(!expr.includes("hermes_call_started_total["));
  });

  it("Der Ausdruck in der Regeldatei stimmt mit dem aus burnrate erzeugten überein", () => {
    const ergebnis = lauf(kopiere());
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.equal(ergebnis.stderr, "");
  });

  it("Eine andere Richtung in menge ohne neuen Ausdruck wird als Abweichung gemeldet", () => {
    const wurzel = kopiere((regeln) => {
      const regel = regeln.find((eintrag) => eintrag.uid === "anruf-annahmezeit");
      regel.burnrate.menge = 'hermes_call_started_total{direction="outbound"}';
      return regeln;
    });
    const ergebnis = lauf(wurzel);
    assert.equal(ergebnis.status, 1);
    assert.match(ergebnis.stderr, /anruf-annahmezeit: expr weicht von burnrate ab/);
  });

  it("Erfolgsquote und Abbruchrate zählen weiter alle Richtungen", () => {
    const werte = ausdruecke();
    for (const uid of ["anruf-erfolgsquote", "anruf-abbruchrate"]) {
      assert.ok(werte[uid].includes("sum(increase(hermes_call_started_total[1h])) >= 20"), uid);
      assert.ok(werte[uid].includes("sum(increase(hermes_call_started_total[6h])) >= 20"), uid);
      assert.ok(!werte[uid].includes('started_total{direction'), uid);
    }
  });
});
