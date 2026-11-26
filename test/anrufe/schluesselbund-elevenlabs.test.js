import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  liesAusSchluesselbund,
  SCHLUESSELBUND_HINWEIS,
  schluesselbundEinsetzen,
} from "../../scripts/lib/schluesselbund-env.mjs";
import { SCHLUESSELBUND_ELEVENLABS_SCHLUESSEL as WERT } from "../gemeinsam/erfundene-geheimnisse.js";

const VARIABLE = "ELEVENLABS_API_KEY";
const HINWEIS = 'security add-generic-password -s elevenlabs -a "$USER" -w';

function stubVerzeichnis(skript) {
  const ordner = mkdtempSync(join(tmpdir(), "security-stub-"));
  const datei = join(ordner, "security");
  writeFileSync(datei, `#!/bin/sh\n${skript}\n`);
  chmodSync(datei, 0o755);
  return ordner;
}

function mitPfad(pfad, aktion) {
  const alt = process.env.PATH;
  process.env.PATH = pfad;
  try {
    return aktion();
  } finally {
    process.env.PATH = alt;
  }
}

function skriptLauf(skript, env) {
  return spawnSync(process.execPath, [skript, "--pruefen"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NODE_ENV: "test", [VARIABLE]: "", ...env },
  });
}

test("Treffer unter darwin: der Wert ohne Zeilenumbruch landet in der Variable", () => {
  const stub = stubVerzeichnis(`[ "$1 $2 $3 $4" = "find-generic-password -s elevenlabs -w" ] || exit 9\necho ${WERT}`);
  const env = {};
  mitPfad(stub, () => schluesselbundEinsetzen({ env, plattform: "darwin" }));
  assert.equal(env[VARIABLE], WERT);
});

test("gesetzte Variable hat Vorrang und security wird nicht aufgerufen", () => {
  const env = { [VARIABLE]: "aus-der-umgebung" };
  let aufrufe = 0;
  schluesselbundEinsetzen({ env, plattform: "darwin", lesen: () => (aufrufe++, WERT) });
  assert.equal(env[VARIABLE], "aus-der-umgebung");
  assert.equal(aufrufe, 0);
});

test("leere Variable aus Leerzeichen zaehlt als leer", () => {
  const env = { [VARIABLE]: "   " };
  schluesselbundEinsetzen({ env, plattform: "darwin", lesen: () => WERT });
  assert.equal(env[VARIABLE], WERT);
});

test("Nicht-darwin: security wird nicht aufgerufen", () => {
  const env = {};
  let aufrufe = 0;
  schluesselbundEinsetzen({ env, plattform: "linux", lesen: () => (aufrufe++, WERT) });
  assert.equal(aufrufe, 0);
  assert.equal(env[VARIABLE], undefined);
});

test("kein Eintrag (Exit ungleich 0): leer, kein Wurf, nichts auf stdout oder stderr", () => {
  const stub = stubVerzeichnis(`echo ${WERT}\nexit 44`);
  const geschrieben = [];
  const alt = [process.stdout.write, process.stderr.write];
  process.stdout.write = (text) => (geschrieben.push(String(text)), true);
  process.stderr.write = (text) => (geschrieben.push(String(text)), true);
  let wert;
  try {
    wert = mitPfad(stub, () => liesAusSchluesselbund());
  } finally {
    [process.stdout.write, process.stderr.write] = alt;
  }
  assert.equal(wert, "");
  assert.equal(geschrieben.join("").includes(WERT), false);
});

test("security fehlt: leer, kein Wurf", () => {
  const leer = mkdtempSync(join(tmpdir(), "ohne-security-"));
  assert.equal(mitPfad(leer, () => liesAusSchluesselbund()), "");
  const env = {};
  mitPfad(leer, () => schluesselbundEinsetzen({ env, plattform: "darwin" }));
  assert.equal(env[VARIABLE], undefined);
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
