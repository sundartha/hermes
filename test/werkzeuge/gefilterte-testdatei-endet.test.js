import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

import { echtWarten } from "../echt-warten.js";

const HILFE = pathToFileURL(
  path.resolve(import.meta.dirname, "../gemeinsam/aufbau-und-abbau.mjs"),
).href;
const FILTER_OHNE_TREFFER = "--test-name-pattern=^gibtesnicht$";
const AUFBAU_DAUER_MS = 300;
const GRENZE_MS = 20_000;
const HOECHSTENS_MS = 10_000;
const TOT_ABWARTEN_MS = 3000;
const POLL_MS = 50;

const aufraeumer = [];

after(() => {
  for (const aufgabe of aufraeumer) aufgabe();
});

function testdatei() {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-gefiltert-"));
  const pidDatei = path.join(ordner, "kind.pid");
  const datei = path.join(ordner, "mit-aufbau.test.js");
  fs.writeFileSync(
    datei,
    `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { aufbauUndAbbau } from ${JSON.stringify(HILFE)};

let kind;

aufbauUndAbbau(
  async () => {
    await sleep(${AUFBAU_DAUER_MS});
    kind = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    writeFileSync(${JSON.stringify(pidDatei)}, String(kind.pid));
  },
  async () => {
    kind?.kill("SIGKILL");
  },
);

test("fall", () => {});
`,
  );
  aufraeumer.push(() => {
    const kind = fs.existsSync(pidDatei) ? Number(fs.readFileSync(pidDatei, "utf8")) : 0;
    if (kind && lebt(kind)) process.kill(kind, "SIGKILL");
    fs.rmSync(ordner, { recursive: true, force: true });
  });
  return { datei, pidDatei };
}

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function wartePidWeg(pid) {
  const frist = Date.now() + TOT_ABWARTEN_MS;
  while (lebt(pid) && Date.now() < frist) await echtWarten(POLL_MS);
  return !lebt(pid);
}

test("eine Testdatei, deren Tests alle weggefiltert sind, endet schnell und hinterlässt keinen Kindprozess", async () => {
  const { datei, pidDatei } = testdatei();
  const umgebung = { ...process.env, NODE_ENV: "test" };
  delete umgebung.NODE_TEST_CONTEXT;

  const start = Date.now();
  const lauf = spawnSync(process.execPath, ["--test", FILTER_OHNE_TREFFER, datei], {
    env: umgebung,
    timeout: GRENZE_MS,
    killSignal: "SIGKILL",
    encoding: "utf8",
  });
  const dauer = Date.now() - start;

  assert.notEqual(
    lauf.error?.code,
    "ETIMEDOUT",
    "die gefilterte Testdatei hängt, bis die Grenze sie abbricht",
  );
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(dauer < HOECHSTENS_MS, `gefilterter Lauf dauerte ${dauer} ms`);
  assert.ok(fs.existsSync(pidDatei), "der Aufbau lief nicht bis zum Ende");
  const kind = Number(fs.readFileSync(pidDatei, "utf8"));
  assert.ok(await wartePidWeg(kind), "der Kindprozess aus dem Aufbau lebt nach dem Lauf noch");
});
