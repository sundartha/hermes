import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { bisBeendet } from "./mutationspruefung-hilfen.js";

const WAECHTER = new URL("../gemeinsam/elternwaechter.mjs", import.meta.url).href;
const TESTHILFEN = new URL("../helpers.js", import.meta.url).href;
const OHNE_PIPE = /Elternwächter ohne stdin-Pipe vom Elternprozess/;

const KIND = `
import { writeSync } from "node:fs";
import { starteElternwaechter } from ${JSON.stringify(WAECHTER)};
starteElternwaechter();
writeSync(1, JSON.stringify({ pid: process.pid }) + "\\n");
for (;;) {}
`;

const ELTERN_MIT_KIND = `
import { spawn } from "node:child_process";
const kind = spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(KIND)}], {
  stdio: ["pipe", "pipe", "inherit"],
});
kind.stdout.once("data", (zeile) => {
  process.stdout.write(zeile, () => process.exit(0));
});
`;

const ELTERN_MIT_TESTSERVER = `
import { startServer } from ${JSON.stringify(TESTHILFEN)};
const server = await startServer();
const zeile = JSON.stringify({ pid: server.child.pid, ordner: server.dataDir }) + "\\n";
process.stdout.write(zeile, () => process.exit(0));
`;

const KIND_OHNE_PIPE_MIT_NUR_PROTOKOLLIERENDEM_GUARD = `
import { createServer } from "node:net";
import { starteElternwaechter } from ${JSON.stringify(WAECHTER)};
process.on("uncaughtException", (fehler) => console.error("[guard]", fehler.message));
createServer().listen(0);
starteElternwaechter();
`;

async function verwaistesKind(elternCode) {
  const eltern = spawn(process.execPath, ["--input-type=module", "-e", elternCode], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  let ausgabe = "";
  let fehler = "";
  eltern.stdout.on("data", (stueck) => (ausgabe += stueck));
  eltern.stderr.on("data", (stueck) => (fehler += stueck));
  await Promise.all([once(eltern, "exit"), once(eltern.stdout, "end")]);
  assert.match(ausgabe, /"pid":\d+/, `Kind hat den Wächter nicht gestartet:\n${fehler}`);
  return JSON.parse(ausgabe);
}

async function pruefeEndeDerWaise({ pid, ordner }) {
  const beendet = await bisBeendet(pid);
  if (!beendet) process.kill(pid, "SIGKILL");
  if (ordner) rmSync(ordner, { recursive: true, force: true });
  assert.ok(beendet, `verwaister Prozess ${pid} lief nach Ablauf der Frist noch`);
}

test("ein verwaister Testserver mit blockierter Ereignisschleife endet von selbst", async () => {
  await pruefeEndeDerWaise(await verwaistesKind(ELTERN_MIT_KIND));
});

test("ein über startServer gestarteter Testserver endet mit seinem Elternprozess", async () => {
  await pruefeEndeDerWaise(await verwaistesKind(ELTERN_MIT_TESTSERVER));
});

test("ein Testserver ohne stdin-Pipe bricht trotz protokollierendem Guard hart ab", async () => {
  const kind = spawn(
    process.execPath,
    ["--input-type=module", "-e", KIND_OHNE_PIPE_MIT_NUR_PROTOKOLLIERENDEM_GUARD],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let fehler = "";
  kind.stderr.on("data", (stueck) => (fehler += stueck));
  const ende = once(kind, "exit");
  const beendet = await bisBeendet(kind.pid);
  if (!beendet) kind.kill("SIGKILL");
  const [, signal] = await ende;
  assert.ok(beendet, `Kind ohne stdin-Pipe lief nach Ablauf der Frist noch:\n${fehler}`);
  assert.equal(signal, "SIGKILL");
  assert.match(fehler, OHNE_PIPE);
});
