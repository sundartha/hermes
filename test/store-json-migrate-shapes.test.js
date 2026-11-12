import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, emptyUsage, defaultSettings, CENTS_PER_EUR } from "../src/store/defaults.js";

let config;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  config = (await import("../src/config.js")).config;
});

let migrateSeq = 0;
async function loadStore(raw) {
  const dir = tempDataDir(raw);
  config.server.dataDir = dir;
  const mod = await import(`../src/store/json.js?migrate-shapes=${migrateSeq++}`);
  return mod.load();
}

test("Migration usage: fehlendes Feld (undefined) -> nur der Owner-Default-Bucket", async () => {
  const state = await loadStore({});
  assert.deepEqual(state.usage, { [BOOTSTRAP_TENANT_ID]: emptyUsage() });
});

test("Migration usage: null -> nur der Owner-Default-Bucket", async () => {
  const state = await loadStore({ usage: null });
  assert.deepEqual(state.usage, { [BOOTSTRAP_TENANT_ID]: emptyUsage() });
});

test("Migration usage: flaches Shape (costEur:number) -> Owner-Bucket mit costCents, costEur entfernt", async () => {
  const flat = { inputTokens: 10, outputTokens: 20, costEur: 0.05, calls: 3 };
  const state = await loadStore({ usage: flat });
  assert.deepEqual(state.usage, {
    [BOOTSTRAP_TENANT_ID]: {
      ...emptyUsage(),
      inputTokens: 10,
      outputTokens: 20,
      calls: 3,
      costCents: Math.round(0.05 * CENTS_PER_EUR),
    },
  });
});

test("Migration usage: bereits eine Map mit >=2 Tenants -> jeder Bucket costCents, Owner ergaenzt", async () => {
  const mapShape = { alex: { costEur: 1.5 }, maria: { calls: 7 } };
  const state = await loadStore({ usage: mapShape });
  assert.deepEqual(state.usage, {
    alex: { ...emptyUsage(), costCents: Math.round(1.5 * CENTS_PER_EUR) },
    maria: { ...emptyUsage(), calls: 7 },
    [BOOTSTRAP_TENANT_ID]: emptyUsage(),
  });
});

test("Migration settings: fehlendes Feld (undefined) -> nur der Owner-Default-Bucket", async () => {
  const state = await loadStore({});
  assert.deepEqual(state.settings, { [BOOTSTRAP_TENANT_ID]: defaultSettings() });
});

test("Migration settings: null -> nur der Owner-Default-Bucket", async () => {
  const state = await loadStore({ settings: null });
  assert.deepEqual(state.settings, { [BOOTSTRAP_TENANT_ID]: defaultSettings() });
});

test("Migration settings: bereits eine Map mit >=2 Tenants -> jeder Bucket aufgefuellt, Owner ergaenzt", async () => {
  const mapShape = { alex: { agentName: "Alex-Agent" }, maria: { agentName: "Maria-Agent" } };
  const state = await loadStore({ settings: mapShape });
  assert.deepEqual(state.settings, {
    alex: { ...defaultSettings(), agentName: "Alex-Agent" },
    maria: { ...defaultSettings(), agentName: "Maria-Agent" },
    [BOOTSTRAP_TENANT_ID]: defaultSettings(),
  });
});
