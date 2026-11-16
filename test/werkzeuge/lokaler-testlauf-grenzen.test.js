import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import * as gruppe from "../gemeinsam/testgruppe.mjs";

const TESTLAUF = resolve(import.meta.dirname, "../testbaenke-run.mjs");
const GRUEN = 'import { test } from "node:test";\ntest("gruen", () => {});\n';
const FRIST_MS = 10_000;
const TESTFRIST = { timeout: 60_000 };

function haengtAn(pfad) {
  return `import { connect } from "node:net";\nconnect(${JSON.stringify(pfad)});\nsetInterval(() => {}, 1000);\n`;
}

function umgebung(zusatz = {}) {
  const basis = { ...process.env, NODE_TEST_CONTEXT: undefined, ...zusatz };
  for (const name of ["GITHUB_ACTIONS", "HERMES_LOKAL_SCHWER", "TEST_TIEFE", "HERMES_AUFRUFER_PID"]) delete basis[name];
  return basis;
}

async function mitHaengendemLauf(zusatz, pruefe) {
  const ordner = mkdtempSync(join(tmpdir(), "lokaler-lauf-"));
  const server = createServer();
  try {
    server.listen(join(ordner, "s"));
    await once(server, "listening");
    const datei = join(ordner, "haengt.test.js");
    writeFileSync(datei, haengtAn(join(ordner, "s")));
    const verbunden = once(server, "connection");
    const lauf = spawn("node", [TESTLAUF, "regression", datei], { cwd: ordner, env: umgebung(zusatz), stdio: ["ignore", "ignore", "pipe"] });
    let fehlerausgabe = "";
    lauf.stderr.on("data", (stueck) => (fehlerausgabe += stueck));
    const [verbindung] = await verbunden;
    const geschlossen = once(verbindung, "close", { signal: AbortSignal.timeout(FRIST_MS) });
    await pruefe({ ordner, datei, lauf, geschlossen, fehler: () => fehlerausgabe });
  } finally {
    server.close();
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Zeitgrenze: Standard 10 Minuten, Umgebung verkürzt, Meldung nennt Grenze und Datei", () => {
  assert.equal(gruppe.zeitgrenzeMinuten({}), 10);
  assert.equal(gruppe.zeitgrenzeMinuten({ HERMES_ZEITGRENZE_MINUTEN: "0.5" }), 0.5);
  const meldung = gruppe.grenzmeldung(10, ["--test", "--test-reporter=tap", "/a/b.test.js"]);
  assert.match(meldung, /10 Minuten/);
  assert.match(meldung, /\/a\/b\.test\.js/);
  assert.doesNotMatch(meldung, /--test/);
});

test("Ein hängender lokaler Testlauf wird nach der Zeitgrenze samt Gruppe beendet und endet rot", TESTFRIST, async () => {
  await mitHaengendemLauf({ HERMES_ZEITGRENZE_MINUTEN: "0.03" }, async ({ lauf, geschlossen, fehler }) => {
    const [status] = await once(lauf, "close");
    assert.equal(status, 1);
    assert.match(fehler(), /Zeitgrenze von 0\.03 Minuten/);
    assert.match(fehler(), /haengt\.test\.js/);
    await geschlossen;
  });
});

test("Endet der Elternprozess per SIGKILL, endet die Gruppe des Testlaufs binnen 10 Sekunden", TESTFRIST, async () => {
  await mitHaengendemLauf({}, async ({ lauf, geschlossen }) => {
    lauf.kill("SIGKILL");
    await geschlossen;
  });
});

test("Ein zweiter lokaler Testlauf im selben Ordner wird sofort abgewiesen, solange der erste lebt", TESTFRIST, async () => {
  await mitHaengendemLauf({}, async ({ ordner, lauf, geschlossen }) => {
    const gruen = join(ordner, "gruen.test.js");
    writeFileSync(gruen, GRUEN);
    const zweiter = spawnSync("node", [TESTLAUF, "regression", gruen], { cwd: ordner, encoding: "utf8", env: umgebung() });
    assert.equal(zweiter.status, 1);
    assert.match(zweiter.stderr, new RegExp(`läuft schon \\(PID ${lauf.pid}`));
    lauf.kill("SIGKILL");
    await geschlossen;
  });
});

test("Mit der Sperre eines toten Vorgängers läuft der Testlauf und gibt die Sperre danach frei", () => {
  const ordner = mkdtempSync(join(tmpdir(), "lokaler-lauf-"));
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
