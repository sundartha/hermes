import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const KINDFRIST_MS = 30_000;

const SKRIPT = `
import "./src/process-guards.js";
import { gemeldeterSchaden } from "./src/utils/lokale-gesundheit.js";
import { makeMemoryQueue } from "./src/queue/adapters/memory/queue.ts";
const queue = makeMemoryQueue();
await queue.plane("aufbewahrung", 5, () => { throw new Error("sofort"); });
const wache = setInterval(() => {
  if (gemeldeterSchaden() === null) return;
  console.log("SCHADEN: " + gemeldeterSchaden());
  clearInterval(wache);
}, 5);
`;

test("Herzschlag-8: ein im memory-Backend sofort werfender Lauf meldet den Prozess wie bisher als beschädigt", () => {
  const ergebnis = spawnSync(process.execPath, ["--input-type=module", "-e", SKRIPT], {
    cwd: WURZEL,
    encoding: "utf8",
    timeout: KINDFRIST_MS,
  });
  assert.match(ergebnis.stdout, /SCHADEN: fehler/);
  assert.match(ergebnis.stderr, /\[guard\] uncaughtException/);
});
