import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("Aufruftext nennt nur Befehle, die deploy-weg wirklich kennt", () => {
  const lauf = spawnSync(process.execPath, ["tools/deploy-weg.mjs", "unbekannt"], {
    encoding: "utf8",
  });
  const zeile = lauf.stdout.split("\n").find((text) => text.startsWith("Aufruf:"));
  const befehle = zeile
    .replace("Aufruf: node tools/deploy-weg.mjs ", "")
    .split(" | ")
    .map((teil) => teil.split(" ")[0]);
  assert.deepEqual(befehle, [
    "staging",
    "entscheiden",
    "hoertest",
    "deploy",
    "zurueckrollen",
    "anrufpause",
    "nachkontrolle",
    "heartbeat",
    "pruefung",
  ]);
});
