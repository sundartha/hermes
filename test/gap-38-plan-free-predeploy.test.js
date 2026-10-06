import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startServer } from "./helpers.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_YAML = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");

test("Blueprint (GAP-38): kein Service mit plan:free traegt einen preDeployCommand", () => {
  const blocks = RENDER_YAML.split(/\n(?=  - type: web)/);
  const offenders = blocks
    .filter((block) => /plan:\s*free/.test(block) && /preDeployCommand:/.test(block))
    .map((block) => (block.match(/name:\s*(\S+)/) || [, "?"])[1]);
  assert.deepEqual(
    offenders,
    [],
    "Render fuehrt preDeployCommand auf plan:free nicht aus - ein Service mit beidem heilt " +
      `sich nie selbst; betroffen: ${offenders.join(", ")}`,
  );
});

test("Blueprint (GAP-38): ein leerer Store + gesetzte BOOTSTRAP_E164/BOOTSTRAP_PROVIDER heilt den Boot IN-PROZESS (kein preDeploy noetig)", async () => {
  let srv;
  await assert.doesNotReject(
    async () => {
      srv = await startServer({
        env: { BOOTSTRAP_E164: "+15005550006", BOOTSTRAP_PROVIDER: "telnyx" },
        ownerNumber: null,
      });
    },
    "der In-Prozess-Boot muss sich mit BOOTSTRAP_E164/BOOTSTRAP_PROVIDER selbst heilen " +
      "koennen, ohne auf den preDeployCommand angewiesen zu sein",
  );
  if (srv) await srv.stop();
});
