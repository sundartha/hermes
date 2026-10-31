import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { einbettungsImport } from "../../tools/mutationspruefung/einbettung.mjs";
import { EINBETTUNG_VORSPANN } from "../../tools/mutationspruefung/zustand.mjs";
import { probeDirectory } from "./probe-repo.js";

const HELFER = new URL("../helpers.js", import.meta.url).href;
const AKTIVER_MUTANT = ["__STRY", "KER_ACTIVE_MUT", "ANT__"].join("");
const SKRIPT = [
  `import { stdioServerTransport } from ${JSON.stringify(HELFER)};`,
  "const { transport } = stdioServerTransport();",
  "process.stdout.write(JSON.stringify(transport._serverParams.env));",
  "",
].join("\n");

function umgebungDesServers(context, umgebung) {
  const ort = probeDirectory(context, { "stdio.mjs": SKRIPT });
  const lauf = spawnSync(process.execPath, ["stdio.mjs"], { cwd: ort, encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test", ...umgebung } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return JSON.parse(lauf.stdout);
}

test("Der MCP-Server, den ein Test über stdio startet, bekommt unter der Mutationsprüfung den aktiven Mutanten und den Vorspann der Einbettung, sonst nichts davon", (context) => {
  const quelle = "/ordner mit leerzeichen/widget.js";
  const vorspann = einbettungsImport(quelle);
  const mit = umgebungDesServers(context, { [AKTIVER_MUTANT]: "9", [EINBETTUNG_VORSPANN]: vorspann.replace("--import=", "") });
  assert.equal(mit[AKTIVER_MUTANT], "9");
  assert.ok(mit.NODE_OPTIONS.split(" ").includes(vorspann), mit.NODE_OPTIONS);
  const ohne = umgebungDesServers(context, {});
  assert.equal(ohne[AKTIVER_MUTANT], undefined);
  assert.doesNotMatch(ohne.NODE_OPTIONS ?? "", /einbettung-vorspann/);
});
