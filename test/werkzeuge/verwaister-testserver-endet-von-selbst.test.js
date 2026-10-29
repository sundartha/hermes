import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { ABFRAGE_MS } from "../../tools/mutationspruefung/ppid-waechter.mjs";
import { BASE_ENV, MCP_STDIO_ARGS, ROOT } from "../helpers.js";
import { bisBeendet } from "./mutationspruefung-hilfen.js";

const WAECHTER = new URL("../gemeinsam/elternwaechter.mjs", import.meta.url).href;
const TESTHILFEN = new URL("../helpers.js", import.meta.url).href;
const STDIO_SERVER_BEREIT = "MCP-Server bereit";
const START_FRIST_MS = 20_000;
const WAECHTER_FRIST_MS = 100;
const PRUEFTAKT_MS = 50;
const SCHLEIFE_BEI_STDIN_ENDE = "--import=data:text/javascript,process.stdin.once('end',()=>{for(;;);})";
const WAECHTER_SCHEITERT = "--import=data:text/javascript,import('node:worker_threads').then((w)=>{if(!w.isMainThread)throw(Error('kein-waechter'))})";
const OHNE_PIPE = /Elternwächter ohne stdin-Pipe vom Elternprozess/;
const OHNE_PPID_ABFRAGE = /Elternwächter ohne ppid-Abfrage: /;

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

const ELTERN_MIT_STDIO_SERVER = `
import { spawn } from "node:child_process";
const kind = spawn(process.execPath, ${JSON.stringify(MCP_STDIO_ARGS)}, {
  cwd: ${JSON.stringify(ROOT)},
  env: ${JSON.stringify({ ...BASE_ENV, NODE_OPTIONS: SCHLEIFE_BEI_STDIN_ENDE })},
  stdio: ["pipe", "pipe", "pipe"],
});
kind.stderr.on("data", (stueck) => {
  if (!String(stueck).includes(${JSON.stringify(STDIO_SERVER_BEREIT)})) return;
  process.stdout.write(JSON.stringify({ pid: kind.pid }) + "\\n", () => process.exit(0));
});
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

test("ein verwaister stdio-Testserver mit blockierter Ereignisschleife endet von selbst", async () => {
  await pruefeEndeDerWaise(await verwaistesKind(ELTERN_MIT_STDIO_SERVER));
});

function starteStdioServer(zusatz = {}) {
  const kind = spawn(process.execPath, MCP_STDIO_ARGS, { cwd: ROOT, env: { ...BASE_ENV, ...zusatz }, stdio: ["pipe", "pipe", "pipe"] });
  const ausgabe = { text: "" };
  kind.stderr.on("data", (stueck) => (ausgabe.text += stueck));
  return { kind, ausgabe };
}

function kindLaeuftNoch(kind) {
  return kind.exitCode === null && kind.signalCode === null;
}

async function bisBereit({ kind, ausgabe }) {
  while (!ausgabe.text.includes(STDIO_SERVER_BEREIT) && kindLaeuftNoch(kind)) await echtWarten(PRUEFTAKT_MS);
  assert.ok(ausgabe.text.includes(STDIO_SERVER_BEREIT), `stdio-Testserver wurde nie bereit:\n${ausgabe.text}`);
}

async function beende(kind) {
  if (!kindLaeuftNoch(kind)) return;
  kind.kill("SIGKILL");
  await once(kind, "close");
}

test("ein stdio-Testserver läuft weiter, solange sein Elternprozess lebt", async () => {
  const server = starteStdioServer();
  try {
    await bisBereit(server);
    assert.ok(WAECHTER_FRIST_MS >= ABFRAGE_MS, "die Wartezeit deckt mindestens eine Abfrage des Wächters ab");
    await echtWarten(WAECHTER_FRIST_MS);
    assert.ok(kindLaeuftNoch(server.kind), server.ausgabe.text);
  } finally {
    await beende(server.kind);
  }
});

test("ein stdio-Testserver endet von selbst, wenn sein stdin schließt", async () => {
  const server = starteStdioServer();
  try {
    await bisBereit(server);
    server.kind.stdin.end();
    const beendet = await bisBeendet(server.kind.pid);
    assert.ok(beendet, `stdio-Testserver lief nach dem Ende von stdin noch:\n${server.ausgabe.text}`);
  } finally {
    await beende(server.kind);
  }
});

test("ein stdio-Testserver, dessen Wächter nicht starten kann, bricht trotz protokollierendem Guard hart ab", async () => {
  const { kind, ausgabe } = starteStdioServer({ NODE_OPTIONS: WAECHTER_SCHEITERT });
  try {
    const [, signal] = await once(kind, "close", { signal: AbortSignal.timeout(START_FRIST_MS) });
    assert.equal(signal, "SIGKILL");
    assert.match(ausgabe.text, OHNE_PPID_ABFRAGE);
  } finally {
    await beende(kind);
  }
});
