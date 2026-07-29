// AL-P10 (PLAN-ASSISTANT-LEAP.md Phase 10) - allowResearch: Default-Wert +
// Admin-Schreibpfad (updateSettings) + Self-Service-Ablehnung (Owner-Gate, Geldpfad) +
// pg-Persistenz-Round-Trip. Muster f2-sms-opt-in-persist.test.js/self-service-patch.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "./pg-helpers.js";
import { makePgStore } from "../src/store/pg.js";
import { defaultSettings, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { selfServicePatch } from "../src/self-service.js";

test("AL-P10-13 defaultSettings().allowResearch === false", () => {
  assert.equal(defaultSettings().allowResearch, false);
});

test("AL-P10-14 updateSettings: Admin-Pfad schreibt true, Nicht-Boolean wird verworfen", async () => {
  const { store } = await makePgTestStore();
  const { changed } = store.updateSettings(BOOTSTRAP_TENANT_ID, { allowResearch: true });
  assert.ok(changed.includes("allowResearch"), "Key ist in der updateSettings-Whitelist");
  assert.equal(store.load().settings[BOOTSTRAP_TENANT_ID].allowResearch, true);

  const { changed: changedGarbage } = store.updateSettings(BOOTSTRAP_TENANT_ID, {
    allowResearch: "ja",
  });
  assert.ok(!changedGarbage.includes("allowResearch"), "Nicht-Boolean wird abgelehnt (Typcheck)");
  assert.equal(
    store.load().settings[BOOTSTRAP_TENANT_ID].allowResearch,
    true,
    "vorheriger Wert bleibt stehen",
  );
});

test("AL-P10-15 selfServicePatch: allowResearch landet in rejected, nie in clean (Owner-Gate O3)", () => {
  const { clean, rejected } = selfServicePatch({ allowResearch: true }, {});
  assert.equal("allowResearch" in clean, false, "kein Self-Service-Schreibpfad in dieser Phase");
  assert.ok(rejected.includes("allowResearch"));
});

test("AL-P10-16 pg: allowResearch ueberlebt Flush + Hydrierung (Reopen)", async () => {
  const { store, runner } = await makePgTestStore();
  assert.equal(
    store.load().settings[BOOTSTRAP_TENANT_ID].allowResearch,
    false,
    "frischer Owner-Bucket traegt den Default false",
  );
  const { changed } = store.updateSettings(BOOTSTRAP_TENANT_ID, { allowResearch: true });
  assert.ok(changed.includes("allowResearch"));
  await store.save();

  // Restart simulieren: neuer Store auf DERSELBEN DB -> hydrate via rowToSettings.
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(
    reopened.load().settings[BOOTSTRAP_TENANT_ID].allowResearch,
    true,
    "true ueberlebt den Reopen (Spalte + hydrate/flush gemappt)",
  );
});
