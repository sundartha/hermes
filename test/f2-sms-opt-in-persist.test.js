// F2 P7 - smsSummaryOptIn: Default-Wert + Persistenz-Round-Trip (pg) + Schreibbarkeit
// ueber die POST /api/settings-Whitelist (updateSettings). pglite (offline, F.I.R.S.T.).
// Kern-Risiko M1: settings ist im pg-Backend SPALTEN-basiert (kein JSON) -> ohne Spalte +
// hydrate/flush ginge der Wert beim Restart still verloren und alle Tenants verloeren ihre
// Summary-SMS. Dieser Test beweist, dass false einen Reopen ueberlebt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "./pg-helpers.js";
import { makePgStore } from "../src/store/pg.js";
import { defaultSettings, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

test("Default true (Bestandsverhalten) in defaultSettings()", () => {
  assert.equal(defaultSettings().smsSummaryOptIn, true);
});

test("pg: frischer Owner-Bucket traegt den Default true", async () => {
  const { store } = await makePgTestStore();
  assert.equal(store.load().settings[BOOTSTRAP_TENANT_ID].smsSummaryOptIn, true);
});

test("pg: smsSummaryOptIn round-trippt (set false -> save -> reopen -> false), M1", async () => {
  const { store, runner } = await makePgTestStore();
  // Abschalten ueber die updateSettings-Whitelist (= POST /api/settings-Pfad).
  const { changed } = store.updateSettings(BOOTSTRAP_TENANT_ID, { smsSummaryOptIn: false });
  assert.ok(changed.includes("smsSummaryOptIn"), "Key ist in der updateSettings-Whitelist");
  await store.save();
  // Restart simulieren: neuer Store auf DERSELBEN DB -> hydrate via rowToSettings.
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(
    reopened.load().settings[BOOTSTRAP_TENANT_ID].smsSummaryOptIn,
    false,
    "false ueberlebt den Reopen (Spalte + hydrate/flush gemappt)",
  );
});

test("updateSettings: Nicht-Boolean wird abgelehnt (Typcheck), Default bleibt", async () => {
  const { store } = await makePgTestStore();
  store.updateSettings(BOOTSTRAP_TENANT_ID, { smsSummaryOptIn: "nein" });
  assert.equal(
    store.load().settings[BOOTSTRAP_TENANT_ID].smsSummaryOptIn,
    true,
    "String abgelehnt (typeof-Check) -> Default true bleibt",
  );
});
