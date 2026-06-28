// P2 - agentStyle: Persistenz-Round-Trip (pg). Kern-Risiko (wie smsSummaryOptIn/M1):
// settings ist im pg-Backend SPALTEN-basiert (kein JSON) -> ohne agent_style-Spalte +
// flush/hydrate ginge der Stil beim Restart still verloren. pglite (offline, F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "./pg-helpers.js";
import { makePgStore } from "../src/store/pg.js";
import { defaultSettings, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

test("pg: frischer Owner-Bucket traegt agentStyle null (Default)", async () => {
  assert.equal(defaultSettings().agentStyle, null);
  const { store } = await makePgTestStore();
  assert.equal(store.load().settings[BOOTSTRAP_TENANT_ID].agentStyle, null);
});

test("pg: agentStyle round-trippt (set -> save -> reopen)", async () => {
  const { store, runner } = await makePgTestStore();
  const { changed } = store.updateSettings(BOOTSTRAP_TENANT_ID, {
    agentStyle: "formell-professionell",
  });
  assert.ok(changed.includes("agentStyle"), "Key in der updateSettings-Whitelist");
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(
    reopened.load().settings[BOOTSTRAP_TENANT_ID].agentStyle,
    "formell-professionell",
    "Stil ueberlebt den Reopen (Spalte + hydrate/flush gemappt)",
  );
});

test("pg: Freitext wird abgelehnt (Katalog-Check), agentStyle bleibt null", async () => {
  const { store } = await makePgTestStore();
  store.updateSettings(BOOTSTRAP_TENANT_ID, { agentStyle: "DR. X VON BANK Y" });
  assert.equal(store.load().settings[BOOTSTRAP_TENANT_ID].agentStyle, null);
});
