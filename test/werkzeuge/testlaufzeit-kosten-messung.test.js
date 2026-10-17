import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, isolatedEnvironment, writeFiles } from "./probe-repo.js";

const LAUF_FRIST_MS = 120_000;
const MINDESTDAUER_EINES_STARTS_MS = 10;
const DATENBANK_HILFE = pathToFileURL(join(REPO_ROOT, "test/pglite-helfer.js")).href;
const SERVER_HILFE = pathToFileURL(join(REPO_ROOT, "test/helpers.js")).href;
const VERWEIGERTER_START = {
  RENDER_EXTERNAL_URL: "https://agent.onrender.com",
  DASHBOARD_PASSWORD: "",
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
};

const MESSTESTDATEI_KOPF = `
import { test } from "node:test";
import { neuePglite } from ${JSON.stringify(DATENBANK_HILFE)};
import { startServer, startServerExpectExit } from ${JSON.stringify(SERVER_HILFE)};
`;
const STARTS = {
  "datenbank.test.js": { art: "datenbankStarts", start: "await neuePglite();" },
  "server-bereit.test.js": {
    art: "serverStarts",
    start: "const server = await startServer();\n  await server.stop();",
  },
  "server-ende.test.js": {
    art: "serverStarts",
    start: `await startServerExpectExit({ env: ${JSON.stringify(VERWEIGERTER_START)} });`,
  },
};

function messtestdatei(start) {
  return `${MESSTESTDATEI_KOPF}\ntest("Start", async () => {\n  ${start}\n});\n`;
}

function eintraegeJeDatei(kostenDatei) {
  const zeilen = readFileSync(kostenDatei, "utf8").trim().split("\n");
  return Object.fromEntries(zeilen.map((zeile) => JSON.parse(zeile)).map((e) => [e.datei, e]));
}

test("die Testhilfen tragen die gemessene Dauer jedes Datenbank- und Serverstarts in die Kosten-Datei ein", (context) => {
  const ordner = mkdtempSync(join(tmpdir(), "testlaufzeit-kosten-"));
  context.after(() => rmSync(ordner, { recursive: true, force: true }));
  writeFiles(
    ordner,
    Object.fromEntries(Object.entries(STARTS).map(([datei, { start }]) => [datei, messtestdatei(start)])),
  );
  const kostenDatei = join(ordner, "testkosten.jsonl");
  const beginn = performance.now();
  const lauf = spawnSync(process.execPath, ["--test", ...Object.keys(STARTS)], {
    cwd: ordner,
    env: { ...isolatedEnvironment(), TESTKOSTEN_DATEI: kostenDatei },
    timeout: LAUF_FRIST_MS,
    encoding: "utf8",
  });
  const laufzeitMs = performance.now() - beginn;
  assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`);
  const eintraege = eintraegeJeDatei(kostenDatei);
  for (const [datei, { art }] of Object.entries(STARTS)) {
    const { summe, ...eintrag } = eintraege[datei];
    assert.deepEqual(eintrag, { datei, art, anzahl: 1 });
    assert.ok(summe > MINDESTDAUER_EINES_STARTS_MS, `${datei}: ${summe} ms`);
    assert.ok(summe < laufzeitMs, `${datei}: ${summe} ms von ${laufzeitMs} ms`);
  }
});
