import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { RUNNER, isolatedEnvironment, probeDirectory } from "./probe-repo.js";

const ANGELEGT = "angelegt.txt";
const ABFRAGE_MS = 50;
const WARTEGRENZE_MS = 30_000;
const LAUF_FRIST_MS = 60_000;
const TEST_FRIST = { timeout: 120_000 };
const EXIT_ROT = 1;

const ANLEGEN = [
  'import { mkdtempSync, writeFileSync } from "node:fs";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  'import { test } from "node:test";',
  "function anlegen() {",
  '  const ordner = mkdtempSync(join(tmpdir(), "probe-"));',
  '  writeFileSync(join(ordner, "inhalt.txt"), "x");',
  `  writeFileSync(${JSON.stringify(ANGELEGT)}, ordner);`,
  "}",
];

const PROBEN = {
  "gruen.test.js": [...ANLEGEN, 'test("legt an", () => anlegen());', ""].join("\n"),
  "rot.test.js": [...ANLEGEN, 'test("legt an und ist rot", () => {', "  anlegen();", '  throw new Error("rot");', "});", ""].join("\n"),
  "haengt.test.js": [...ANLEGEN, 'test("legt an und hängt", async () => {', "  anlegen();", "  await new Promise(() => setInterval(() => {}, 1000));", "});", ""].join("\n"),
};

function umgebung(context) {
  const aussen = mkdtempSync(join(tmpdir(), "temp-aussen-"));
  context.after(() => rmSync(aussen, { recursive: true, force: true }));
  return { aussen, env: { ...isolatedEnvironment(), NODE_ENV: "test", TMPDIR: aussen } };
}

function angelegterOrdner(ordner) {
  return readFileSync(join(ordner, ANGELEGT), "utf8");
}

function nichtsUebrig(aussen, angelegt) {
  assert.equal(existsSync(angelegt), false, `${angelegt} liegt noch da`);
  assert.deepEqual(readdirSync(aussen), []);
}

function laufe(probe, context) {
  const ordner = probeDirectory(context, PROBEN);
  const { aussen, env } = umgebung(context);
  const ergebnis = spawnSync(process.execPath, [RUNNER, "regression", probe], {
    cwd: ordner,
    env,
    encoding: "utf8",
    timeout: LAUF_FRIST_MS,
  });
  return { ergebnis, aussen, angelegt: angelegterOrdner(ordner) };
}

async function bis(bedingung) {
  const ende = Date.now() + WARTEGRENZE_MS;
  while (!bedingung() && Date.now() < ende) await echtWarten(ABFRAGE_MS);
  return bedingung();
}

test("nach einem grünen Lauf ist der Ordner, den ein Test im Temp-Ordner anlegt, weg und außen bleibt nichts", TEST_FRIST, (context) => {
  const { ergebnis, aussen, angelegt } = laufe("gruen.test.js", context);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  nichtsUebrig(aussen, angelegt);
});

test("nach einem roten Lauf ist der Ordner, den ein Test im Temp-Ordner anlegt, weg und außen bleibt nichts", TEST_FRIST, (context) => {
  const { ergebnis, aussen, angelegt } = laufe("rot.test.js", context);
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  nichtsUebrig(aussen, angelegt);
});

test("bricht die Frist den Lauf mit SIGTERM ab, ist der Ordner des Tests weg und außen bleibt nichts", TEST_FRIST, async (context) => {
  const ordner = probeDirectory(context, PROBEN);
  const { aussen, env } = umgebung(context);
  const lauf = spawn(process.execPath, [RUNNER, "regression", "haengt.test.js"], { cwd: ordner, env, stdio: "ignore" });
  context.after(() => lauf.kill("SIGKILL"));
  const beendet = new Promise((fertig) => lauf.on("exit", (_code, signal) => fertig(signal)));
  assert.ok(await bis(() => existsSync(join(ordner, ANGELEGT))), "der hängende Test hat nichts angelegt");
  lauf.kill("SIGTERM");
  assert.equal(await beendet, "SIGTERM");
  nichtsUebrig(aussen, angelegterOrdner(ordner));
});
