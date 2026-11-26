import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { elevenLabsSchluessel, SCHLUESSELBUND_HINWEIS } from "../../scripts/lib/schluesselbund.mjs";
import { SCHLUESSELBUND_ELEVENLABS_SCHLUESSEL as WERT } from "../gemeinsam/erfundene-geheimnisse.js";

const VARIABLE = "ELEVENLABS_API_KEY";
const HINWEIS = 'security add-generic-password -s elevenlabs -a "$USER" -w';

function skriptLauf(skript, env) {
  return spawnSync(process.execPath, [skript, "--pruefen"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NODE_ENV: "test", [VARIABLE]: "", ...env },
  });
}

function zaehler(antwort) {
  const aufrufe = [];
  const ausfuehren = (befehl, args) => {
    aufrufe.push([befehl, ...args]);
    if (antwort instanceof Error) throw antwort;
    return antwort;
  };
  return { aufrufe, ausfuehren };
}

test("Treffer unter darwin: der Wert ohne Zeilenumbruch ist der Schluessel", () => {
  const { aufrufe, ausfuehren } = zaehler(`${WERT}\n`);
  assert.equal(elevenLabsSchluessel("", { plattform: "darwin", ausfuehren }), WERT);
  assert.deepEqual(aufrufe, [["security", "find-generic-password", "-s", "elevenlabs", "-w"]]);
});

test("gesetzte Variable hat Vorrang und security wird nicht aufgerufen", () => {
  const { aufrufe, ausfuehren } = zaehler(WERT);
  assert.equal(elevenLabsSchluessel("aus-der-umgebung", { plattform: "darwin", ausfuehren }), "aus-der-umgebung");
  assert.equal(aufrufe.length, 0);
});

test("Wert aus Leerzeichen zaehlt als leer", () => {
  const { ausfuehren } = zaehler(WERT);
  assert.equal(elevenLabsSchluessel("   ", { plattform: "darwin", ausfuehren }), WERT);
});

test("Nicht-darwin: security wird nicht aufgerufen", () => {
  const { aufrufe, ausfuehren } = zaehler(WERT);
  assert.equal(elevenLabsSchluessel("", { plattform: "linux", ausfuehren }), "");
  assert.equal(aufrufe.length, 0);
});

test("kein Eintrag oder security fehlt: leer, kein Wurf, der Fehlertext traegt den Wert nicht", () => {
  for (const fehler of [Object.assign(new Error(`Exit 44 ${WERT}`), { status: 44 }), Object.assign(new Error("ENOENT"), { code: "ENOENT" })]) {
    const { ausfuehren } = zaehler(fehler);
    const geschrieben = [];
    const alt = [process.stdout.write, process.stderr.write];
    process.stdout.write = (text) => (geschrieben.push(String(text)), true);
    process.stderr.write = (text) => (geschrieben.push(String(text)), true);
    let wert;
    try {
      wert = elevenLabsSchluessel("", { plattform: "darwin", ausfuehren });
    } finally {
      [process.stdout.write, process.stderr.write] = alt;
    }
    assert.equal(wert, "");
    assert.equal(geschrieben.join(""), "");
  }
});

test("security wird mit Frist und ohne geerbten stderr aufgerufen", () => {
  let optionen;
  elevenLabsSchluessel("", { plattform: "darwin", ausfuehren: (_b, _a, o) => ((optionen = o), WERT) });
  assert.equal(optionen.encoding, "utf8");
  assert.equal(optionen.timeout, 5000);
  assert.deepEqual(optionen.stdio, ["ignore", "pipe", "ignore"]);
});

test("Treffer: die Hinterlege-Anweisung nennt den Befehl und keinen Wert", () => {
  assert.equal(SCHLUESSELBUND_HINWEIS.includes(HINWEIS), true);
  assert.equal(SCHLUESSELBUND_HINWEIS.includes(WERT), false);
});

for (const skript of ["scripts/el-nummern-registrierung.mjs", "scripts/push-elevenlabs.mjs", "scripts/check-elevenlabs-drift.mjs"]) {
  test(`${skript}: ohne Schluessel nennt die Fehlermeldung den Befehl zum Hinterlegen`, () => {
    const lauf = skriptLauf(skript, { ELEVENLABS_AGENT_ID: "agent_x" });
    assert.notEqual(lauf.status, 0);
    assert.equal((lauf.stderr + lauf.stdout).includes(HINWEIS), true);
  });
}
