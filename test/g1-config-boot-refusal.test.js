// G1: Owner-Identitaet ist Boot-Pflicht (fail-closed). Fehlt OWNER_FIRST_NAME oder
// OWNER_LAST_NAME, verweigert assertConfig den Boot (Exit non-zero, Diagnose nennt die
// Var). Der "Jonas"-Default ist an der Quelle verschwunden. Spawn-Test ueber das
// bestehende Boot-Refusal-Muster (startServerExpectExit). WICHTIG (Pre-Mortem b):
// BASE_ENV setzt OWNER_FIRST_NAME/OWNER_LAST_NAME -> der Reject-Test muss sie im
// Spawn-Env explizit LEEREN, sonst maskiert BASE_ENV den Refusal (scheingruen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServerExpectExit } from "./helpers.js";

test("Boot-Refusal: fehlendes OWNER_FIRST_NAME stoppt den Start (Exit + Diagnose)", async () => {
  const { code, output } = await startServerExpectExit({ env: { OWNER_FIRST_NAME: "" } });
  assert.notEqual(code, 0, "Boot muss verweigert werden (Exit non-zero)");
  assert.match(output, /OWNER_FIRST_NAME/, "Diagnose muss OWNER_FIRST_NAME nennen");
});

test("Boot-Refusal: fehlendes OWNER_LAST_NAME stoppt den Start (Exit + Diagnose)", async () => {
  const { code, output } = await startServerExpectExit({ env: { OWNER_LAST_NAME: "" } });
  assert.notEqual(code, 0, "Boot muss verweigert werden (Exit non-zero)");
  assert.match(output, /OWNER_LAST_NAME/, "Diagnose muss OWNER_LAST_NAME nennen");
});
