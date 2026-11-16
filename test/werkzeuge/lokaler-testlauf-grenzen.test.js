import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import * as gruppe from "../gemeinsam/testgruppe.mjs";

const TESTLAUF = resolve(import.meta.dirname, "../testbaenke-run.mjs");
const HAENGT = (pidDatei) =>
  `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidDatei)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`;
const GRUEN = 'import { test } from "node:test";\ntest("gruen", () => {});\n';

function umgebung(zusatz = {}) {
  const basis = { ...process.env, NODE_TEST_CONTEXT: undefined, ...zusatz };
  for (const name of ["GITHUB_ACTIONS", "HERMES_LOKAL_SCHWER", "TEST_TIEFE", "HERMES_AUFRUFER_PID"]) delete basis[name];
  return basis;
}

function arbeitsordner() {
  return mkdtempSync(join(tmpdir(), "lokaler-lauf-"));
}

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function bis(bedingung, fristMs) {
  const ende = Date.now() + fristMs;
  while (!bedingung() && Date.now() < ende) await echtWarten(50);
  return bedingung();
}

function starte(ordner, datei, zusatz) {
  return spawn("node", [TESTLAUF, "regression", datei], { cwd: ordner, env: umgebung(zusatz), stdio: "ignore" });
}

test("Zeitgrenze: Standard 10 Minuten, Umgebung verkürzt, Meldung nennt Grenze und Datei", () => {
  assert.equal(gruppe.zeitgrenzeMinuten({}), 10);
  assert.equal(gruppe.zeitgrenzeMinuten({ HERMES_ZEITGRENZE_MINUTEN: "0.5" }), 0.5);
  const meldung = gruppe.grenzmeldung(10, ["--test", "--test-reporter=tap", "/a/b.test.js"]);
  assert.match(meldung, /10 Minuten/);
  assert.match(meldung, /\/a\/b\.test\.js/);
  assert.doesNotMatch(meldung, /--test/);
});

test("Ein hängender lokaler Testlauf wird nach der Zeitgrenze samt Gruppe beendet und endet rot", async () => {
  const ordner = arbeitsordner();
  try {
    const pidDatei = join(ordner, "pid");
    const datei = join(ordner, "haengt.test.js");
    writeFileSync(datei, HAENGT(pidDatei));
    const lauf = spawnSync("node", [TESTLAUF, "regression", datei], {
      cwd: ordner,
      encoding: "utf8",
      env: umgebung({ HERMES_ZEITGRENZE_MINUTEN: "0.03" }),
      timeout: 60_000,
    });
    assert.equal(lauf.status, 1);
    assert.match(lauf.stderr, /Zeitgrenze von 0\.03 Minuten/);
    assert.match(lauf.stderr, /haengt\.test\.js/);
    assert.equal(lebt(Number(readFileSync(pidDatei, "utf8"))), false);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

test("Endet der Elternprozess per SIGKILL, endet die Gruppe des Testlaufs binnen 10 Sekunden", async () => {
  const ordner = arbeitsordner();
  try {
    const pidDatei = join(ordner, "pid");
    const datei = join(ordner, "haengt.test.js");
    writeFileSync(datei, HAENGT(pidDatei));
    const eltern = starte(ordner, datei);
    assert.equal(await bis(() => existsSync(pidDatei) && readFileSync(pidDatei, "utf8") !== "", 20_000), true);
    const testPid = Number(readFileSync(pidDatei, "utf8"));
    assert.equal(lebt(testPid), true);
    eltern.kill("SIGKILL");
    assert.equal(await bis(() => !lebt(testPid), 10_000), true);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

test("Ein zweiter lokaler Testlauf im selben Ordner wird sofort abgewiesen, solange der erste lebt", async () => {
  const ordner = arbeitsordner();
  try {
    const pidDatei = join(ordner, "pid");
    const haengt = join(ordner, "haengt.test.js");
    const gruen = join(ordner, "gruen.test.js");
    writeFileSync(haengt, HAENGT(pidDatei));
    writeFileSync(gruen, GRUEN);
    const erster = starte(ordner, haengt);
    assert.equal(await bis(() => existsSync(pidDatei) && readFileSync(pidDatei, "utf8") !== "", 20_000), true);
    const zweiter = spawnSync("node", [TESTLAUF, "regression", gruen], { cwd: ordner, encoding: "utf8", env: umgebung() });
    assert.equal(zweiter.status, 1);
    assert.match(zweiter.stderr, new RegExp(`läuft schon \\(PID ${erster.pid}`));
    const testPid = Number(readFileSync(pidDatei, "utf8"));
    erster.kill("SIGKILL");
    assert.equal(await bis(() => !lebt(testPid), 10_000), true);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

test("Mit der Sperre eines toten Vorgängers läuft der Testlauf und gibt die Sperre danach frei", () => {
  const ordner = arbeitsordner();
  try {
    const tot = spawnSync("node", ["-e", ""]).pid;
    spawnSync("mkdir", ["-p", join(ordner, ".pruefung")]);
    writeFileSync(join(ordner, ".pruefung", "lauf.pid"), String(tot));
    const datei = join(ordner, "gruen.test.js");
    writeFileSync(datei, GRUEN);
    const lauf = spawnSync("node", [TESTLAUF, "regression", datei], { cwd: ordner, encoding: "utf8", env: umgebung() });
    assert.equal(lauf.status, 0);
    assert.equal(existsSync(join(ordner, ".pruefung", "lauf.pid")), false);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});
