import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const KINDFRIST_MS = 30_000;

const LAUF_SOFORT = '() => { throw new Error("sofort"); }';

const skript = (lauf) => `
import "./src/process-guards.js";
import { gemeldeterSchaden } from "./src/utils/lokale-gesundheit.js";
import { makeMemoryQueue } from "./src/queue/adapters/memory/queue.ts";
const queue = makeMemoryQueue();
await queue.plane("aufbewahrung", 5, ${lauf});
const wache = setInterval(async () => {
  if (gemeldeterSchaden() === null) return;
  console.log("SCHADEN: " + gemeldeterSchaden());
  clearInterval(wache);
  const echt = Date.now;
  Date.now = () => echt() + 2 * 60 * 60 * 1000;
  console.log("UEBERFAELLIG: " + JSON.stringify(await queue.ueberfaellige()));
}, 5);
`;

test("Herzschlag-8: ein im memory-Backend sofort werfender Lauf meldet den Prozess wie bisher als beschädigt und setzt keinen Herzschlag", () => {
  const ergebnis = spawnSync(process.execPath, ["--input-type=module", "-e", skript(LAUF_SOFORT)], {
    cwd: WURZEL,
    encoding: "utf8",
    timeout: KINDFRIST_MS,
  });
  assert.match(ergebnis.stdout, /SCHADEN: fehler/);
  assert.match(ergebnis.stdout, /UEBERFAELLIG: \["aufbewahrung"\]/);
  assert.match(ergebnis.stderr, /\[guard\] uncaughtException/);
});

const SKRIPT_ASYNC = `
import "./src/process-guards.js";
import { makeMemoryQueue } from "./src/queue/adapters/memory/queue.ts";
const queue = makeMemoryQueue();
await queue.plane("aufbewahrung", 5, async () => { throw new Error("spaeter"); });
setTimeout(async () => {
  const echt = Date.now;
  Date.now = () => echt() + 2 * 60 * 60 * 1000;
  console.log("UEBERFAELLIG: " + JSON.stringify(await queue.ueberfaellige()));
  process.exit(0);
}, 100);
`;

test("Herzschlag-9: ein im memory-Backend asynchron scheiternder Lauf wird als unbehandelte Ablehnung gemeldet und setzt keinen Herzschlag", () => {
  const ergebnis = spawnSync(process.execPath, ["--input-type=module", "-e", SKRIPT_ASYNC], {
    cwd: WURZEL,
    encoding: "utf8",
    timeout: KINDFRIST_MS,
  });
  assert.match(ergebnis.stdout, /UEBERFAELLIG: \["aufbewahrung"\]/);
  assert.match(ergebnis.stderr, /\[guard\] unhandledRejection: Error: spaeter/);
});
