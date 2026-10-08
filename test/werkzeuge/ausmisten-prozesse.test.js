import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { EXIT_GRUEN, messeUndMelde } from "./ausmisten/messung.mjs";

const MARKE = `hermes-ausmisten-server-${process.pid}`;
const SERVER_TEST = "test/post/server.test.js";
const PROZESSLISTE = ["-axo", "pid=,args="];

function uebrigeServer() {
  const { stdout } = spawnSync("ps", PROZESSLISTE, { encoding: "utf8" });
  const zeilen = stdout.split("\n").filter((zeile) => zeile.includes(MARKE));
  return zeilen.map((zeile) => Number.parseInt(zeile, 10)).filter(Number.isInteger);
}

function beendeUebrige() {
  for (const pid of uebrigeServer()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      continue;
    }
  }
}

const SERVER = [
  'import assert from "node:assert/strict";',
  'import { spawn } from "node:child_process";',
  'import { test } from "node:test";',
  'import { eingang } from "../../src/post/eingang.js";',
  "",
  'test("startet einen Server und kürzt", () => {',
  `  const server = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ${JSON.stringify(MARKE)}], { stdio: "ignore" });`,
  "  server.unref();",
  '  assert.equal(eingang(" a "), "a");',
  "});",
  "",
].join("\n");

test("ausmisten-prozesse: nach einer Messung läuft kein Server weiter, den ein gemessener Test gestartet hat", async (context) => {
  context.after(beendeUebrige);
  const ergebnis = await messeUndMelde(
    context,
    { weg: [SERVER_TEST] },
    { dateien: { [SERVER_TEST]: SERVER } },
  );
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  assert.deepEqual(uebrigeServer(), []);
});
