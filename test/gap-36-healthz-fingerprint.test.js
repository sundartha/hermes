// GAP-36 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-36").
// /healthz muss Commit und einen secret-/PII-freien Konfigurations-Fingerabdruck
// ausweisen (post-Deploy-Smoke + Rollback-Drill brauchen einen Vergleichswert).
// Gefixt in P1: src/config-fingerprint.js + src/app.js /healthz + src/config.js
// (deployedCommit). Reihe 1 (Spawn, Bestand) + 2-3 (Spawn, Raw-Value-/Diff-Beweis) +
// 4-6 (Unit, DIP - configFingerprint nimmt config als Argument, kein Env/Spawn noetig).
//
// OpenAI-P10b: configHash verlaesst /healthz (Preimage-Befund - der Hash war live aus
// 9216 Kandidaten eindeutig zurueckrechenbar, PLAN-SECURITY.md Abschnitt "OpenAI-P10b"
// Punkt 1; ein
// Vergleichswert BLEIBT noetig, wandert aber hinter eine Admin-Sitzung, s.
// src/routes/api-deploy-info.js) + ins Boot-Log (src/boot.js, unveraendert). GAP-36s
// urspruenglicher Zweck (Post-Deploy-Smoke, Rollback-Drill) bleibt darueber erfuellt -
// Reihe 1-3 pruefen jetzt die neue Aufteilung statt der alten /healthz-Form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { configFingerprint } from "../src/config-fingerprint.js";

// Bewusst KEIN gueltiger Hex-Wert (40 Hex-Zeichen waeren ein legitimer SHA) - Test 2
// beweist NUR, dass der markierte Rohwert 1:1 in der Antwort landet, nicht ob er als
// SHA plausibel ist.
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
    // Kein 64-stelliger Hex-String im Rohtext - der Hash-Wert selbst (nicht nur seine
    // Achsen) darf nicht mehr in der oeffentlichen Antwort stehen.
    assert.doesNotMatch(raw, /[a-f0-9]{64}/);
    // D8: Hex-Alphabet-Ausschluss statt Ziffernfolgen->=7-Regel (commit ist ein Hex-
    // String, der zufaellig 7 Ziffern in Folge enthalten kann). Jeder der markierten
    // Rohwerte enthaelt mindestens ein Nicht-Hex-Zeichen -> kein Zufallstreffer.
    for (const leak of ["+49", "+33", "sk_", "leakcanary", "eur"]) {
      assert.ok(!raw.includes(leak), `Rohwert '${leak}' darf nicht in /healthz auftauchen`);
    }
  } finally {
    await srv.stop();
  }
});

// OpenAI-P10b: configHash steht nicht mehr in der Antwort - der Vergleich laeuft jetzt
// ueber die Boot-Log-Zeile "[boot] configHash=..." (zweite, unveraenderte Quelle,
// src/boot.js). Vorbedingung prueft ZUERST, dass beide Captures wirklich einen Hash
// tragen (nicht undefined) - sonst waere ein leerer Vergleich still gruen.
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
      // P7: die beiden Kosten-Decken sind Achsen 6 und 7 - ohne sie war eine reine
      // Zahlen-Aenderung an den Decken am laufenden Dienst nicht belegbar.
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
