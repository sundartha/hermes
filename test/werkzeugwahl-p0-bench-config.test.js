import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEnv,
  benchTenantsFor,
  assertProfileTenantIsSettable,
  DEFAULT_AGENT_MODEL,
  DEFAULT_LLM_PROVIDER_FOR_BENCH,
} from "../scripts/convo-bench/runner.mjs";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { LLM_PROVIDER } from "../src/llm/provider.js";
import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME } from "./helpers.js";

const baseArgs = (overrides = {}) => ({
  apiKey: "anthropic-key",
  deepseekApiKey: undefined,
  llmProvider: DEFAULT_LLM_PROVIDER_FOR_BENCH,
  agentModel: DEFAULT_AGENT_MODEL,
  scenario: {},
  driverEnv: {},
  searchEnv: {},
  ...overrides,
});

test("T-P0-1 buildEnv setzt Vorgabewerte byte-identisch zum Bestand (Anthropic/Haiku)", () => {
  const env = buildEnv(baseArgs());
  assert.equal(env.LLM_PROVIDER, "anthropic");
  assert.equal(env.CLAUDE_MODEL, "claude-haiku-4-5");
  assert.equal(env.DEEPSEEK_API_KEY, "");
  assert.equal(env.ANTHROPIC_API_KEY, "anthropic-key");
});

test("T-P0-2 buildEnv reicht --llm-provider deepseek + --agent-model + DEEPSEEK_API_KEY wirklich an den Kindprozess-Env durch (Regressionsfang fuer die vorher hart gepinnte Konstante)", () => {
  const env = buildEnv(
    baseArgs({
      llmProvider: LLM_PROVIDER.DEEPSEEK,
      agentModel: "deepseek-v4-pro",
      deepseekApiKey: "ds-key",
    }),
  );
  assert.equal(env.LLM_PROVIDER, "deepseek");
  assert.equal(env.CLAUDE_MODEL, "deepseek-v4-pro");
  assert.equal(env.DEEPSEEK_API_KEY, "ds-key");
  assert.notEqual(env.CLAUDE_MODEL, "claude-haiku-4-5");
});

test("T-P0-3 buildEnv: fehlender deepseekApiKey wird nie zu undefined im Spawn-Env (waere ein Boot-Refusal-Rauschen)", () => {
  const env = buildEnv(baseArgs({ deepseekApiKey: undefined }));
  assert.equal(env.DEEPSEEK_API_KEY, "");
  assert.notEqual(env.DEEPSEEK_API_KEY, undefined);
});

test("T-P0-4 buildEnv: bestehende Praezedenz bleibt erhalten - scenario.env < driverEnv < searchEnv, auch fuer die drei neuen Felder", () => {
  const env = buildEnv(
    baseArgs({
      llmProvider: LLM_PROVIDER.DEEPSEEK,
      agentModel: "deepseek-v4-pro",
      scenario: { env: { CLAUDE_MODEL: "aus-scenario" } },
      driverEnv: { CLAUDE_MODEL: "aus-driver" },
      searchEnv: { CLAUDE_MODEL: "aus-search" },
    }),
  );
  assert.equal(env.CLAUDE_MODEL, "aus-search", "searchEnv gewinnt zuletzt (Bestandspraezedenz)");
});

test("T-P0-5 assertProfileTenantIsSettable failt laut, wenn ein Szenario Profilrechte auf dem Owner-Tenant setzen will (sonst totes Verhalten, R2 pinnt OWNER_PROFILE hart)", () => {
  assert.throws(
    () => assertProfileTenantIsSettable({ id: "x", profile: { allowLookup: true } }, BOOTSTRAP_TENANT_ID),
    /Owner/,
  );
});

test("T-P0-6 assertProfileTenantIsSettable laesst einen Nicht-Owner-Tenant mit profile durch", () => {
  assert.doesNotThrow(() =>
    assertProfileTenantIsSettable({ id: "x", profile: { allowLookup: false } }, "tenant_bench_1"),
  );
});

test("T-P0-7 assertProfileTenantIsSettable laesst den Owner-Tenant OHNE profile durch (Bestandsfall, kein Szenario setzt tenantId/profile)", () => {
  assert.doesNotThrow(() => assertProfileTenantIsSettable({ id: "x" }, BOOTSTRAP_TENANT_ID));
});

test("T-P0-8 benchTenantsFor liefert fuer den Owner-Tenant null (kein zusaetzlicher Seed-Key, byte-identischer Bestand)", () => {
  assert.equal(benchTenantsFor(BOOTSTRAP_TENANT_ID), null);
});

test("T-P0-9 benchTenantsFor traegt fuer einen Nicht-Owner-Tenant eine minimale Identitaet nach (sonst rendert disclosureSentence mit leerem Namen)", () => {
  const tenants = benchTenantsFor("tenant_bench_1");
  assert.deepEqual(tenants, [
    { id: "tenant_bench_1", status: "active", ownerName: `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}` },
  ]);
});
