import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

test("hängt mit einem Enkel", async () => {
  const enkel = spawn("sleep", ["600"], { stdio: "ignore" });
  const pids = { lauf: process.ppid, datei: process.pid, enkel: enkel.pid };
  writeFileSync(process.env.TESTGRUPPE_PIDS, JSON.stringify(pids));
  await new Promise(() => {});
});
