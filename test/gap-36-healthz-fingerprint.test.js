import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { configFingerprint } from "../src/config-fingerprint.js";

const FAKE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

test("/healthz weist commit aus, configHash NICHT mehr (GAP-36, gehaertet in OpenAI-P10b)", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.commit === "string" && body.commit.length > 0, "commit-Feld gesetzt");
    assert.equal("configHash" in body, false, "configHash darf /healthz nicht mehr verlassen");
  } finally {
    await srv.stop();
  }
});

test("/healthz-Antwort traegt genau {commit, ok} und keinen Rohwert, keinen 64-Hex-Hash (GAP-36)", async () => {
  const srv = await startServer({
    env: {
      RENDER_GIT_COMMIT: FAKE_COMMIT,
      ALLOWED_COUNTRY_CODES: "+49,+33",
      MCP_AUTH_TOKEN: "sk_test_leakcanary",
    },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    const raw = await res.text();
    const body = JSON.parse(raw);
    assert.deepEqual(Object.keys(body).sort(), ["commit", "ok"]);
    assert.equal(body.commit, FAKE_COMMIT);
    assert.doesNotMatch(raw, /[a-f0-9]{64}/);
    for (const leak of ["+49", "+33", "sk_", "leakcanary", "eur"]) {
      assert.ok(!raw.includes(leak), `Rohwert '${leak}' darf nicht in /healthz auftauchen`);
    }
  } finally {
    await srv.stop();
  }
});

test("zwei Konfigurationen liefern zwei configHash im Boot-Log (GAP-36)", async () => {
  const srvA = await startServer({ env: { ALLOWED_COUNTRY_CODES: "+49" } });
  const srvB = await startServer({ env: { ALLOWED_COUNTRY_CODES: "+49,+33" } });
  try {
    const matchA = srvA.stdout.match(/\[boot\] configHash=([a-f0-9]{64})/);
    const matchB = srvB.stdout.match(/\[boot\] configHash=([a-f0-9]{64})/);
    assert.ok(matchA, "Boot-Log A traegt keinen configHash");
    assert.ok(matchB, "Boot-Log B traegt keinen configHash");
    assert.notEqual(matchA[1], matchB[1]);
  } finally {
    await srvA.stop();
    await srvB.stop();
  }
});

function fingerprintConfig(overrides = {}) {
  return {
    safety: { allowedCountryCodes: ["+49"], maxCallsPerHour: 20, ...overrides.safety },
    billing: {
      budgetMonthEnabled: false,
      paymentCurrency: "eur",
      platformSpendCapCents: 3000,
      defaultTenantBudgetCents: 1500,
      ...overrides.billing,
    },
    tenancy: { multiTenant: true, ...overrides.tenancy },
  };
}

test("configFingerprint ist deterministisch und 64 Hex-Zeichen (GAP-36)", () => {
  const cfg = fingerprintConfig();
  const a = configFingerprint(cfg);
  const b = configFingerprint(cfg);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("jede der sieben Achsen aendert den configFingerprint (GAP-36, P7)", () => {
  const base = configFingerprint(fingerprintConfig());
  const variants = [
    fingerprintConfig({ safety: { allowedCountryCodes: ["+49", "+33"] } }),
    fingerprintConfig({ safety: { maxCallsPerHour: 999 } }),
    fingerprintConfig({ billing: { budgetMonthEnabled: true } }),
    fingerprintConfig({ tenancy: { multiTenant: false } }),
    fingerprintConfig({ billing: { paymentCurrency: "usd" } }),
    fingerprintConfig({ billing: { platformSpendCapCents: 800 } }),
    fingerprintConfig({ billing: { defaultTenantBudgetCents: 600 } }),
  ];
  for (const variant of variants) {
    assert.notEqual(configFingerprint(variant), base, "Achse muss den Hash aendern");
  }
});

test("configFingerprint gibt keinen Rohwert preis (GAP-36, Absolute Regel 4)", () => {
  const hash = configFingerprint(
    fingerprintConfig({ billing: { budgetMonthEnabled: false, paymentCurrency: "eur" } }),
  );
  assert.ok(!hash.includes("+49"));
  assert.ok(!hash.includes("eur"));
});
