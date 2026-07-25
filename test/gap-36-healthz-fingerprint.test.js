// GAP-36 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-36").
// /healthz muss Commit und einen secret-/PII-freien Konfigurations-Fingerabdruck
// ausweisen (post-Deploy-Smoke + Rollback-Drill brauchen einen Vergleichswert).
// Gefixt in P1: src/config-fingerprint.js + src/app.js /healthz + src/config.js
// (deployedCommit). Reihe 1 (Spawn, Bestand) + 2-3 (Spawn, Raw-Value-/Diff-Beweis) +
// 4-6 (Unit, DIP - configFingerprint nimmt config als Argument, kein Env/Spawn noetig).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { configFingerprint } from "../src/config-fingerprint.js";

// Bewusst KEIN gueltiger Hex-Wert (40 Hex-Zeichen waeren ein legitimer SHA) - Test 2
// beweist NUR, dass der markierte Rohwert 1:1 in der Antwort landet, nicht ob er als
// SHA plausibel ist.
const FAKE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

test("/healthz weist commit und configHash aus (GAP-36, gefixt in P1)", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.commit === "string" && body.commit.length > 0, "commit-Feld gesetzt");
    assert.ok(
      typeof body.configHash === "string" && body.configHash.length > 0,
      "configHash-Feld gesetzt",
    );
  } finally {
    await srv.stop();
  }
});

test("/healthz-Antwort traegt genau {ok, commit, configHash} und keinen Rohwert (GAP-36)", async () => {
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
    assert.deepEqual(Object.keys(body).sort(), ["commit", "configHash", "ok"]);
    assert.equal(body.commit, FAKE_COMMIT);
    assert.match(body.configHash, /^[a-f0-9]{64}$/);
    // D8: Hex-Alphabet-Ausschluss statt Ziffernfolgen->=7-Regel (commit/configHash sind
    // beide Hex-Strings, die zufaellig 7 Ziffern in Folge enthalten koennen). Jeder der
    // markierten Rohwerte enthaelt mindestens ein Nicht-Hex-Zeichen -> kein Zufallstreffer.
    for (const leak of ["+49", "+33", "sk_", "leakcanary", "eur"]) {
      assert.ok(!raw.includes(leak), `Rohwert '${leak}' darf nicht in /healthz auftauchen`);
    }
  } finally {
    await srv.stop();
  }
});

test("zwei Konfigurationen liefern zwei configHash (GAP-36)", async () => {
  const srvA = await startServer({ env: { ALLOWED_COUNTRY_CODES: "+49" } });
  const srvB = await startServer({ env: { ALLOWED_COUNTRY_CODES: "+49,+33" } });
  try {
    const bodyA = await (await fetch(`${srvA.localUrl}/healthz`)).json();
    const bodyB = await (await fetch(`${srvB.localUrl}/healthz`)).json();
    assert.notEqual(bodyA.configHash, bodyB.configHash);
  } finally {
    await srvA.stop();
    await srvB.stop();
  }
});

function fingerprintConfig(overrides = {}) {
  return {
    safety: { allowedCountryCodes: ["+49"], maxCallsPerHour: 20, ...overrides.safety },
    billing: { budgetMonthEnabled: false, paymentCurrency: "eur", ...overrides.billing },
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

test("jede der fuenf Achsen aendert den configFingerprint (GAP-36)", () => {
  const base = configFingerprint(fingerprintConfig());
  const variants = [
    fingerprintConfig({ safety: { allowedCountryCodes: ["+49", "+33"] } }),
    fingerprintConfig({ safety: { maxCallsPerHour: 999 } }),
    fingerprintConfig({ billing: { budgetMonthEnabled: true, paymentCurrency: "eur" } }),
    fingerprintConfig({ tenancy: { multiTenant: false } }),
    fingerprintConfig({ billing: { budgetMonthEnabled: false, paymentCurrency: "usd" } }),
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
