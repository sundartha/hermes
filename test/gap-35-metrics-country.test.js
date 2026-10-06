import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createMetrics } from "../src/metrics.js";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { startServer, seedState, placeCall, waitForLog } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_YAML = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");

function readRenderValue(text, name) {
  const m = text.match(new RegExp(`key:\\s*${name}\\s*\\n\\s*value:\\s*"?([^"\\n]+)"?`));
  if (!m) throw new Error(`${name} nicht in render.yaml gefunden`);
  return m[1].trim();
}

test("render.yaml mit mehr als einem Land im Gate traegt METRICS_ENABLED=true (GAP-35)", () => {
  const allowedCountryCodes = readRenderValue(RENDER_YAML, "ALLOWED_COUNTRY_CODES");
  const codeCount = allowedCountryCodes === "*" ? Infinity : allowedCountryCodes.split(",").length;
  assert.ok(
    codeCount > 1,
    `Vorbedingung: render.yaml oeffnet mehr als ein Land (war: '${allowedCountryCodes}')`,
  );
  const metricsEnabled = readRenderValue(RENDER_YAML, "METRICS_ENABLED");
  assert.equal(metricsEnabled, "true");
});

test("createMetrics bietet ein Ablehnungs-Ereignis an (GAP-35)", () => {
  const logged = [];
  const metrics = createMetrics({ enabled: true, log: (kind, payload) => logged.push({ kind, payload }) });
  const denialEvents = Object.keys(metrics).filter((name) => /denial|denied|reject/i.test(name));
  assert.ok(denialEvents.length > 0, `Ablehnungs-Ereignis fehlt: ${Object.keys(metrics).join(", ")}`);
});

test("das Ablehnungs-Ereignis ist PII-frei: nur grund/country/language (GAP-35)", () => {
  const logged = [];
  const metrics = createMetrics({ enabled: true, log: (kind, payload) => logged.push({ kind, payload }) });
  metrics.logCallDenied({
    grund: "land",
    country: "DE",
    language: "de",
    to: "+4915112345678",
    tenantId: "t_leak",
    transcript: "vertrauliches Gespraech",
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].kind, "call_denied");
  assert.deepEqual(Object.keys(logged[0].payload).sort(), ["country", "grund", "language"]);
  const serialized = JSON.stringify(logged[0]);
  assert.ok(!/\+\d{6,}/.test(serialized), "keine Rufnummer im geloggten Payload");
  assert.ok(!serialized.includes("t_leak"), "keine tenantId im geloggten Payload");
});

test("das Ablehnungs-Ereignis schweigt bei METRICS_ENABLED=false (GAP-35)", () => {
  const logged = [];
  const metrics = createMetrics({ enabled: false, log: (kind, payload) => logged.push({ kind, payload }) });
  metrics.logCallDenied({ grund: "land", country: "DE", language: "de" });
  assert.equal(logged.length, 0);
});

function defaultStore() {
  return {
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    load: () => ({
      numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
    }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice" }),
    resolveProfile: () => ({
      unrestricted: true,
      allowedCountryCodes: null,
      maxCallsPerHour: null,
      allowedNumbers: [],
    }),
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: () => true,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    reserveExceedsBudget: () => true,
    claimPlatformSpendWarning: () => null,
  };
}

function defaultConfig() {
  return {
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    platformSpendCapCents: 800,
    allowedCountryCodes: ["+49"],
    maxCallsPerHour: 100,
    perTargetWindowMs: 3600000,
    perTargetCallCap: 100,
  };
}

function makeDeps(o = {}) {
  return {
    store: { ...defaultStore(), ...o.store },
    config: withConfigNamespaces({ ...defaultConfig(), ...o.config }),
    requestTenant: o.requestTenant ?? (() => "T"),
    internalIdentity: o.internalIdentity ?? (() => null),
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
  };
}

const gateBy = (gates, name) => gates.find((g) => g.name === name);
const VALID_TO = "+491711234567";

function baseCtx(overrides = {}) {
  return {
    req: {},
    to: VALID_TO,
    objective: "Termin vereinbaren",
    b: {},
    requestedBy: "owner",
    tenantId: "T",
    profile: {
      unrestricted: true,
      allowedCountryCodes: null,
      maxCallsPerHour: null,
      allowedNumbers: [],
    },
    ...overrides,
  };
}

test("jeder auditierte Deny traegt den Grund als eigenes Feld (GAP-35)", async () => {
  {
    const deps = makeDeps({ config: { outboundFrozen: true } });
    const { gates } = makeOutboundGates(deps);
    const denial = await gateBy(gates, "outbound_frozen").run(baseCtx());
    assert.equal(denial.audit.grund, "frozen");
    assert.ok(denial.audit.detail.includes("grund=frozen"));
  }
  {
    const deps = makeDeps({ config: { allowedCountryCodes: ["+33"] } });
    const { gates } = makeOutboundGates(deps);
    const denial = await gateBy(gates, "number_gate").run(baseCtx());
    assert.equal(denial.audit.grund, "land");
    assert.ok(denial.audit.detail.includes("grund=land"));
  }
  {
    const deps = makeDeps({ store: { budgetExceeded: () => true } });
    const { gates } = makeOutboundGates(deps);
    const denial = await gateBy(gates, "budget").run(baseCtx());
    assert.equal(denial.audit.grund, "budget_tenant");
    assert.ok(denial.audit.detail.includes("grund=budget_tenant"));
  }
});

test("eine Land-Ablehnung erzeugt eine call_denied-Zeile mit Land und Sprache (GAP-35)", async () => {
  const seed = seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        firstName: "Jonas",
        ownerName: "Jonas Beispiel",
        country: "DE",
        defaultLanguage: "de",
      },
    ],
  });
  const srv = await startServer({
    env: { METRICS_ENABLED: "true", ALLOWED_COUNTRY_CODES: "+49" },
    seed,
  });
  try {
    const res = await placeCall(srv, "+12025550143");
    assert.equal(res.status, 403);
    await waitForLog(srv, /\[metrics\] call_denied /);
    const match = srv.stdout.match(/\[metrics\] call_denied (\{.*\})/);
    assert.ok(match, `call_denied-Zeile nicht gefunden in:\n${srv.stdout}`);
    const payload = JSON.parse(match[1]);
    assert.equal(payload.grund, "land");
    assert.equal(payload.country, "DE");
    assert.equal(payload.language, "de");
    assert.ok(!match[1].includes("+12025550143"), "Zielnummer darf nicht in der call_denied-Zeile stehen");
  } finally {
    await srv.stop();
  }
});
