import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VORSPANN = path.join(ROOT, "test", "gemeinsam", "pglite-pool-vorspann.mjs");
const NICHT_GEOEFFNET = /Speicher nicht geoeffnet/;
const TELNYX_NUMMER = "+491701234567";

const SKRIPTE = [
  ["bootstrap-tenant.js", [TELNYX_NUMMER, "telnyx"]],
  ["seed-owner-number.js", [TELNYX_NUMMER, "telnyx"]],
  ["erase-tenant.js", ["fremd-a", "--confirm"]],
  ["kv2-7-nachlauf-phasenschnitt.js", []],
  ["kv2-9-nachlauf-zwangssettlement.js", []],
  ["check-setup.js", [], 1],
  ["unlock-tenant.js", ["owner", "--apply"]],
  ["reconcile-payment-method-types.js", []],
  ["reconcile-stale-subscriptions.js", []],
];

function lauf(skript, argumente) {
  return spawnSync(process.execPath, ["--import", VORSPANN, path.join(ROOT, "scripts", skript), ...argumente], {
    cwd: ROOT,
    env: kindUmgebung({
      ...BASE_ENV,
      DATA_DIR: tempDataDir(),
      STORE_BACKEND: "pg",
      DATABASE_URL: "postgres://attrappe.invalid/hermes",
      STRIPE_SECRET_KEY: "sk_test_attrappe",
    }),
    encoding: "utf8",
    timeout: 60000,
  });
}

for (const [skript, argumente, erwarteterStatus = 0] of SKRIPTE) {
  test(`${skript} oeffnet den Speicher mit pg ausdruecklich`, () => {
    const ergebnis = lauf(skript, argumente);
    const ausgabe = ergebnis.stdout + ergebnis.stderr;
    assert.ok(!NICHT_GEOEFFNET.test(ausgabe), ausgabe);
    assert.equal(ergebnis.status, erwarteterStatus, ausgabe.slice(0, 1500));
  });
}
