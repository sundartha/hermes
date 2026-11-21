import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { ROOT, tempDataDir } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

test("npm run check nennt keine TeXML-Voice-Engine mehr", () => {
  const lauf = spawnSync(process.execPath, ["scripts/check-setup.js"], {
    cwd: ROOT,
    env: kindUmgebung({ NODE_ENV: "test", DATA_DIR: tempDataDir() }),
    encoding: "utf8",
    timeout: 8000,
  });
  const ausgabe = `${lauf.stdout}${lauf.stderr}`;
  assert.match(ausgabe, /Ergebnis:/);
  assert.doesNotMatch(ausgabe, /TeXML/);
  assert.doesNotMatch(ausgabe, /Voice-Engine: budget/);
});
