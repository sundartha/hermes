import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { EXIT_PROZESS_UEBRIG, TESTGRUPPE } from "../../tools/testgruppe.mjs";
import { REPO_ROOT, RUNNER, isolatedEnvironment } from "./probe-repo.js";

const HELFER = join(REPO_ROOT, "test/werkzeuge/testgruppe");
const SAUBER = join(HELFER, "sauber.mjs");
const REST = join(HELFER, "rest.mjs");
const HAENGT = join(HELFER, "haengt.mjs");
const ELTERN = join(HELFER, "eltern.mjs");
const PIDS = "pids.json";
const STARTER = "starter.json";
const ABFRAGE_MS = 50;
const WARTEGRENZE_MS = 30_000;
const ZEITABLAUF_MS = 5000;
const LAUF_FRIST_MS = 60_000;
const TEST_FRIST = { timeout: 120_000 };
const PROZESSE_NACH_ELTERNTOD = 4;
const VERSTOSS = /^Verstoß: Prozess nach dem Testlauf übrig: (\d+) sleep 600$/m;
const ALLE_BESTANDEN = /^# pass 1$/m;
const EINER_ROT = /^# fail 1$/m;
const EXIT_ROTER_TEST = 1;

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function bis(bedingung) {
  const ende = Date.now() + WARTEGRENZE_MS;
  while (!bedingung() && Date.now() < ende) await echtWarten(ABFRAGE_MS);
  return bedingung();
}

function gelesen(datei) {
  try {
    return JSON.parse(readFileSync(datei, "utf8"));
  } catch {
    return null;
  }
}

async function pidsAus(datei) {
  await bis(() => gelesen(datei) !== null);
  return gelesen(datei) ?? {};
}

function alleTot(pids) {
  return pids.every((pid) => !lebt(pid));
}

function lauf(context) {
  const ordner = mkdtempSync(join(tmpdir(), "testgruppe-"));
  context.after(() => {
    const pids = [PIDS, STARTER].flatMap((name) =>
      Object.values(gelesen(join(ordner, name)) ?? {}),
    );
    for (const pid of pids.filter(lebt)) process.kill(pid, "SIGKILL");
    rmSync(ordner, { recursive: true, force: true });
  });
  const datei = join(ordner, PIDS);
  return { ordner, datei, env: { ...isolatedEnvironment(), TESTGRUPPE_PIDS: datei } };
}

function starte(argumente, { env, cwd }) {
  return spawnSync(process.execPath, argumente, {
    cwd,
    env,
    encoding: "utf8",
    timeout: LAUF_FRIST_MS,
  });
}

async function gemeldetUndBeendet(ergebnis, datei) {
  const { enkel } = gelesen(datei) ?? {};
  assert.equal(VERSTOSS.exec(ergebnis.stderr)?.[1], String(enkel));
  assert.ok(await bis(() => !lebt(enkel)), `Enkel ${enkel} lebt noch`);
}

async function nachElterntodAllesBeendet(context, argumente) {
  const { ordner, datei, env } = lauf(context);
  const eltern = spawn(process.execPath, [ELTERN, join(ordner, STARTER), ...argumente], {
    cwd: ordner,
    env,
    stdio: "ignore",
  });
  context.after(() => eltern.kill("SIGKILL"));
  const pids = Object.values(await pidsAus(datei));
  eltern.kill("SIGKILL");
  const alle = [...pids, ...Object.values(gelesen(join(ordner, STARTER)) ?? {})];
  assert.equal(alle.length, PROZESSE_NACH_ELTERNTOD);
  assert.ok(await bis(() => alleTot(alle)), JSON.stringify(alle));
}

test("ein Lauf ohne übrige Prozesse endet mit Exit 0, reicht die Ausgabe durch und meldet nichts", () => {
  const ergebnis = starte([TESTGRUPPE, "--test", SAUBER], { env: isolatedEnvironment() });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  assert.match(ergebnis.stdout, ALLE_BESTANDEN);
  assert.doesNotMatch(ergebnis.stderr, /Verstoß/);
});

test(
  "ein zurückgelassener Prozess macht den grünen Lauf mit eigenem Exit-Code rot, wird gemeldet und beendet",
  TEST_FRIST,
  async (context) => {
    const { datei, env } = lauf(context);
    const ergebnis = starte([TESTGRUPPE, "--test", REST], { env });
    assert.equal(ergebnis.status, EXIT_PROZESS_UEBRIG, ergebnis.stderr);
    assert.match(ergebnis.stdout, ALLE_BESTANDEN);
    await gemeldetUndBeendet(ergebnis, datei);
  },
);

test(
  "ein roter Lauf mit zurückgelassenem Prozess behält seinen Exit-Code, der Prozess wird gemeldet und beendet",
  TEST_FRIST,
  async (context) => {
    const { datei, env } = lauf(context);
    const ergebnis = starte([TESTGRUPPE, "--test", REST], { env: { ...env, TESTGRUPPE_ROT: "ja" } });
    assert.equal(ergebnis.status, EXIT_ROTER_TEST, ergebnis.stderr);
    assert.match(ergebnis.stdout, EINER_ROT);
    await gemeldetUndBeendet(ergebnis, datei);
  },
);

test(
  "ein Zeitablauf von spawnSync beendet die ganze Gruppe, der Aufrufer sieht SIGTERM",
  TEST_FRIST,
  async (context) => {
    const { datei, env } = lauf(context);
    const ergebnis = spawnSync(process.execPath, [TESTGRUPPE, "--test", HAENGT], {
      env,
      encoding: "utf8",
      timeout: ZEITABLAUF_MS,
    });
    const pids = gelesen(datei) ?? {};
    assert.equal(ergebnis.signal, "SIGTERM");
    assert.equal(ergebnis.error?.code, "ETIMEDOUT");
    assert.deepEqual(Object.keys(pids).sort(), ["datei", "enkel", "lauf"]);
    assert.ok(await bis(() => alleTot(Object.values(pids))), JSON.stringify(pids));
  },
);

test(
  "stirbt der Aufrufer des Starters an SIGKILL, endet die Gruppe nach wenigen Sekunden",
  TEST_FRIST,
  (context) => nachElterntodAllesBeendet(context, [TESTGRUPPE, "--test", HAENGT]),
);

test(
  "stirbt node --test an SIGKILL, beendet der Starter den Rest und endet mit demselben Signal",
  TEST_FRIST,
  async (context) => {
    const { datei, env } = lauf(context);
    const starter = spawn(process.execPath, [TESTGRUPPE, "--test", HAENGT], {
      env,
      stdio: "ignore",
    });
    context.after(() => starter.kill("SIGKILL"));
    const beendet = new Promise((fertig) => starter.on("exit", (_code, signal) => fertig(signal)));
    const { lauf: runner, datei: testdatei, enkel } = await pidsAus(datei);
    process.kill(runner, "SIGKILL");
    assert.equal(await beendet, "SIGKILL");
    assert.ok(await bis(() => alleTot([testdatei, enkel])), `${testdatei} ${enkel}`);
  },
);

test(
  "stirbt der Aufrufer von testbaenke-run an SIGKILL, endet auch dessen Testlauf",
  TEST_FRIST,
  (context) => nachElterntodAllesBeendet(context, [RUNNER, "regression", HAENGT]),
);

test(
  "testbaenke-run meldet einen zurückgelassenen Prozess und endet rot",
  TEST_FRIST,
  async (context) => {
    const { ordner, datei, env } = lauf(context);
    const ergebnis = starte([RUNNER, "regression", REST], { env, cwd: ordner });
    assert.notEqual(ergebnis.status, 0, ergebnis.stdout);
    await gemeldetUndBeendet(ergebnis, datei);
  },
);
