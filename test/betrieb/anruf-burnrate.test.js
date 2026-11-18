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
const UIDS = ["anruf-erfolgsquote", "anruf-annahmezeit", "anruf-abbruchrate"];

function kopiere() {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "anruf-burnrate-"));
  fs.mkdirSync(path.join(wurzel, "docs", "betrieb", "grafana"), { recursive: true });
  for (const datei of [ANRUFREGELN, path.join("docs", "betrieb", "grafana", "alarmregeln.json")]) {
    fs.copyFileSync(path.join(ROOT, datei), path.join(wurzel, datei));
  }
  fs.cpSync(path.join(ROOT, SEITEN), path.join(wurzel, SEITEN), { recursive: true });
  return wurzel;
}

function probe(fenster) {
  const daten = Object.fromEntries(UIDS.map((uid) => [uid, fenster]));
  const lauf = spawnSync(
    process.execPath,
    [SKRIPT, "--wurzel", kopiere(), "--probe", JSON.stringify(daten)],
    { encoding: "utf8" },
  );
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return JSON.parse(lauf.stdout);
}

function fensterwerte(quote, anrufe) {
  return Object.fromEntries(["1h", "5m", "6h", "30m"].map((name) => [name, { quote, anrufe }]));
}

describe("Anruf-Alarme mit Burn-Rate", () => {
  it("hohe Fehlerquote löst im schnellen Fensterpaar aus", () => {
    const ausgeloest = probe(fensterwerte(0.2, 20));
    assert.deepEqual(
      ausgeloest.map((eintrag) => eintrag.uid).sort(),
      [...UIDS].sort(),
    );
    assert.deepEqual(
      ausgeloest.map((eintrag) => eintrag.fenster),
      ["1h+5m", "1h+5m", "1h+5m"],
    );
  });

  it("mäßige Dauer-Fehlerquote löst im langsamen Fensterpaar aus", () => {
    const fenster = { ...fensterwerte(0.07, 300), "5m": { quote: 0.001, anrufe: 5 } };
    const ausgeloest = probe(fenster);
    assert.deepEqual(
      ausgeloest.map((eintrag) => eintrag.fenster),
      ["6h+30m", "6h+30m", "6h+30m"],
    );
  });

  it("gute Quote löst nicht aus", () => {
    assert.deepEqual(probe(fensterwerte(0.001, 500)), []);
    assert.deepEqual(probe(fensterwerte(0.144, 500)).filter((e) => e.fenster === "1h+5m"), []);
    assert.deepEqual(probe(fensterwerte(0.06, 500)), []);
  });

  it("schlechte Quote bei unter 20 Anrufen löst nicht aus", () => {
    assert.deepEqual(probe(fensterwerte(0.5, 19)), []);
  });

  it("nur kurzes Fenster schlecht löst nicht aus", () => {
    const kurzSchlecht = { ...fensterwerte(0.001, 500), "5m": { quote: 0.5, anrufe: 50 } };
    assert.deepEqual(probe(kurzSchlecht), []);
    const langSchlecht = { ...fensterwerte(0.001, 500), "1h": { quote: 0.5, anrufe: 500 } };
    assert.deepEqual(probe(langSchlecht), []);
  });

  it("Ausdruck weicht von den Burn-Rate-Angaben ab wird gemeldet", () => {
    const wurzel = kopiere();
    const datei = path.join(wurzel, ANRUFREGELN);
    const regeln = JSON.parse(fs.readFileSync(datei, "utf8"));
    const { burnrate } = regeln[1];
    const schnellesPaar = burnrate.fenster[0];
    schnellesPaar[2] = 10;
    fs.writeFileSync(datei, JSON.stringify(regeln));
    const lauf = spawnSync(process.execPath, [SKRIPT, "--wurzel", wurzel], { encoding: "utf8" });
    assert.equal(lauf.status, 1);
    assert.match(lauf.stderr, /anruf-annahmezeit: expr weicht von burnrate ab/);
    assert.doesNotMatch(lauf.stderr, /anruf-erfolgsquote/);
  });

  it("echte anrufregeln.json enthält anruf-erfolgsquote, anruf-annahmezeit, anruf-abbruchrate und meldet an bereitschaft", () => {
    const wurzel = kopiere();
    const lauf = spawnSync(process.execPath, [SKRIPT, "--wurzel", wurzel], { encoding: "utf8" });
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    const regeln = JSON.parse(fs.readFileSync(path.join(wurzel, ANRUFREGELN), "utf8"));
    assert.deepEqual(
      regeln.map((regel) => regel.uid),
      UIDS,
    );
    assert.deepEqual(
      regeln.map((regel) => regel.notification_settings.receiver),
      ["bereitschaft", "bereitschaft", "bereitschaft"],
    );
    for (const uid of UIDS) {
      assert.ok(fs.existsSync(path.join(wurzel, SEITEN, `${uid}.md`)), uid);
    }
  });
});
