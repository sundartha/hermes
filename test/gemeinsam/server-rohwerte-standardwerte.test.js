import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { kindUmgebung } from "./kind-umgebung.mjs";
import { BASE_ENV, ROOT } from "../helpers.js";

const SKRIPT = [
  'import("./src/config.js").then(({ config }) => {',
  "  const { port, shutdownDrainTimeoutMs, herzschlagTaktMs, herzschlagVerzugGrenzeMs, herzschlagFristMs } = config.server;",
  "  process.stdout.write(JSON.stringify({ port, shutdownDrainTimeoutMs, herzschlagTaktMs, herzschlagVerzugGrenzeMs, herzschlagFristMs }));",
  "});",
].join("\n");

test("Server-Rohwerte: ohne gesetzte Variablen gelten Port 3000 und die Herzschlag-Standardfristen", () => {
  const umgebung = { ...BASE_ENV, NODE_ENV: "test" };
  for (const name of ["PORT", "SHUTDOWN_DRAIN_TIMEOUT_MS", "HERZSCHLAG_TAKT_MS", "HERZSCHLAG_VERZUG_GRENZE_MS", "HERZSCHLAG_FRIST_MS"]) {
    delete umgebung[name];
  }
  const ausgabe = execFileSync(process.execPath, ["--input-type=module", "-e", SKRIPT], {
    cwd: ROOT,
    env: kindUmgebung(umgebung),
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(ausgabe), {
    port: 3000,
    shutdownDrainTimeoutMs: 8000,
    herzschlagTaktMs: 60000,
    herzschlagVerzugGrenzeMs: 2000,
    herzschlagFristMs: 5000,
  });
});
