import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isolatedEnvironment } from "../werkzeuge/probe-repo.js";

const NEUE_ROUTE = "/api/negativtest-ohne-einordnung";
const VORLADEN = fileURLToPath(new URL("neue-route-ohne-einordnung.mjs", import.meta.url));
const BERICHT = fileURLToPath(new URL("fehlschlag-werte.mjs", import.meta.url));
const INVENTAR = fileURLToPath(new URL("../route-auth-inventory.test.js", import.meta.url));
const EXIT_OK = 0;

test("SG-22 neue Route ohne Auth-Einordnung wird gestoppt", () => {
  const lauf = spawnSync(
    process.execPath,
    ["--import", VORLADEN, `--test-reporter=${BERICHT}`, INVENTAR],
    { encoding: "utf8", env: { ...isolatedEnvironment(), NEUE_ROUTE, NODE_ENV: "test" } },
  );
  assert.notEqual(lauf.status, EXIT_OK, lauf.stderr);
  const fehlschlaege = lauf.stdout.trim().split("\n");
  assert.ok(fehlschlaege.includes(JSON.stringify([`GET ${NEUE_ROUTE}`])), lauf.stdout);
});
