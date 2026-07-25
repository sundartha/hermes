// GAP-38 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-38").
// plan:free und preDeployCommand stehen nicht am selben Service - Render fuehrt
// preDeployCommand auf dem Free-Tier NICHT aus (Erfahrungswert, memory
// owner-removal-chain), also heilt scripts/bootstrap-tenant.js den leeren Store live
// NIE. Teil (1): Datei-Test gegen render.yaml (Muster test/render-region.test.js -
// reiner Datei-Read, keine yaml-Dependency). Teil (2): Boot-Test - ein leerer Store MIT
// gesetzten BOOTSTRAP_*-Variablen muss sich IN-PROZESS heilen koennen.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startServer } from "./helpers.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_YAML = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");

test("GAP-38 SOLL: kein Service mit plan:free traegt einen preDeployCommand", () => {
  const blocks = RENDER_YAML.split(/\n(?=  - type: web)/);
  const offenders = blocks
    .filter((block) => /plan:\s*free/.test(block) && /preDeployCommand:/.test(block))
    .map((block) => (block.match(/name:\s*(\S+)/) || [, "?"])[1]);
  assert.deepEqual(
    offenders,
    [],
    "SOLL: Render fuehrt preDeployCommand auf plan:free nicht aus - ein Service mit " +
      `beidem heilt sich nie selbst; heute betroffen: ${offenders.join(", ")} (render.yaml:13,31)`,
  );
});

test("GAP-38 SOLL: ein leerer Store + gesetzte BOOTSTRAP_E164/BOOTSTRAP_PROVIDER heilt den Boot IN-PROZESS (kein preDeploy noetig)", async () => {
  let srv;
  await assert.doesNotReject(
    async () => {
      srv = await startServer({
        env: { BOOTSTRAP_E164: "+15005550006", BOOTSTRAP_PROVIDER: "twilio" },
        ownerNumber: null, // bewusst KEINE aktive Nummer seeden - "leerer Store"
      });
    },
    "SOLL: der In-Prozess-Boot muss sich mit BOOTSTRAP_E164/BOOTSTRAP_PROVIDER selbst heilen " +
      "koennen, ohne auf den preDeployCommand angewiesen zu sein; heute bricht der Boot ab " +
      "(src/boot.js:228-234: hasActiveNumber(store.load()) ist false -> exit(1); BOOTSTRAP_* " +
      "wird nirgends im In-Prozess-Boot gelesen, nur von scripts/bootstrap-tenant.js)",
  );
  if (srv) await srv.stop();
});
