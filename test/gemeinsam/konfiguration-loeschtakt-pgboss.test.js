import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ROOT } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

function ladeLoeschtakt(umgebung) {
  const script = [
    'import("./src/config.js").then(({ config, configFatalErrors }) => {',
    "process.stdout.write(JSON.stringify({ fehler: configFatalErrors(), takt: config.store.webhookZustellungLoeschtaktMs }));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
}

const FAELLE = [
  { name: "pgboss mit 59999 ms meldet einen Befund", queue: "pgboss", takt: "59999", fehler: 1 },
  { name: "pgboss mit 500 ms meldet einen Befund", queue: "pgboss", takt: "500", fehler: 1 },
  { name: "pgboss mit 60000 ms ist gueltig", queue: "pgboss", takt: "60000", fehler: 0 },
  { name: "pgboss mit 90000 ms wird wie bisher auf 60000 begrenzt", queue: "pgboss", takt: "90000", fehler: 0 },
  { name: "memory mit 500 ms bleibt gueltig", queue: "memory", takt: "500", fehler: 0 },
];

for (const fall of FAELLE) {
  test(`Loeschtakt der Webhook-Ablage: ${fall.name}`, () => {
    const ist = ladeLoeschtakt({ QUEUE_BACKEND: fall.queue, WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: fall.takt });
    const befunde = ist.fehler.filter((b) => b.startsWith("WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS="));
    assert.equal(befunde.length, fall.fehler);
    if (fall.fehler === 1) {
      assert.match(befunde[0], /Minimum 60000/);
      assert.match(befunde[0], /pgboss/);
    }
  });
}
