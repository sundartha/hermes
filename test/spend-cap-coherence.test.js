// P3 (Boot-Guards Konfig-Kohaerenz/Modellpreise): reine, arg-injizierte Wahrheitstabellen
// fuer spendCapCoherence + unpricedModels (Muster fakeOriginateBootBlocked/meterMappingGaps
// in test/boot-guard.test.js). Kein Spawn, kein Netz - F.I.R.S.T.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spendCapCoherence, unpricedModels, SPEND_CAP_FINDING } from "../src/boot-guard.js";
import { config } from "../src/config.js";
import { PRICES } from "./_prices.js";

test("T-P3-01: Tenant-Default >= Plattform-Cap -> genau ein fataler Befund, nennt beide Zahlen", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 1000,
    platformCapCents: 800,
    maxTariffCents: 300,
    maxCallDurationS: 300,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.equal(findings[0].code, SPEND_CAP_FINDING.TENANT_DEFAULT_INERT);
  assert.match(findings[0].message, /1000/);
  assert.match(findings[0].message, /800/);
});

test("T-P3-02: Grenzfall Gleichstand (>=, nicht >) -> fatal", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 800,
    platformCapCents: 800,
    maxTariffCents: 300,
    maxCallDurationS: 300,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.equal(findings[0].code, SPEND_CAP_FINDING.TENANT_DEFAULT_INERT);
});

test("T-P3-03: knapp unter dem Cap, kein Tarif -> kein fataler Befund", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 799,
    platformCapCents: 800,
    maxTariffCents: 0,
    maxCallDurationS: 300,
  });
  assert.equal(findings.some((f) => f.fatal), false);
});

test("T-P3-04: Sentinel 0 -> A0-WARN, nie fatal, Klausel B feuert bei Default 0 nicht", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 0,
    platformCapCents: 800,
    maxTariffCents: 300,
    maxCallDurationS: 300,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, SPEND_CAP_FINDING.TENANT_DEFAULT_UNSET);
});

test("T-P3-05: Worst-Case-Reserve (300*ceil(180/60)=900) > Tenant-Decke 800 -> genau ein WARN, nennt max_duration_s=120", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 800,
    platformCapCents: 1200,
    maxTariffCents: 300,
    maxCallDurationS: 180,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, SPEND_CAP_FINDING.WORST_CASE_UNAFFORDABLE);
  assert.match(findings[0].message, /max_duration_s=120/);
});

test("T-P3-06: Worst-Case-Reserve unter der Tenant-Decke -> kohaerent, [] ", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 2000,
    platformCapCents: 5000,
    maxTariffCents: 300,
    maxCallDurationS: 300,
  });
  assert.deepEqual(findings, []);
});

test("T-P3-07: unpricedModels meldet exakt die IDs ohne Preistabellen-Eintrag", () => {
  assert.deepEqual(
    unpricedModels(["claude-haiku-4-5", "claude-opus-4-5-20260101"], PRICES.modelPricesUsd),
    ["claude-opus-4-5-20260101"],
  );
});

test("T-P3-08: unpricedModels auf leerer Modell-Liste -> []", () => {
  assert.deepEqual(unpricedModels([], PRICES.modelPricesUsd), []);
});

// T-P3-09: Boot-Killer-Riegel gegen den ECHTEN guardedConfig-Proxy. Object.keys statt
// fester Modell-IDs -> keine Kopplung an die Preistabelle (Regel test/_prices.js).
test("T-P3-09: unpricedModels wirft NICHT auf der echten config-Oberflaeche (Proxy-Trap-Kontrast)", () => {
  const [known] = Object.keys(config.llm.modelPricesUsd);
  assert.ok(known, "Preistabelle darf nicht leer sein");
  assert.doesNotThrow(() => unpricedModels([known, "gibt-es-nicht"], config.llm.modelPricesUsd));
  assert.deepEqual(unpricedModels([known, "gibt-es-nicht"], config.llm.modelPricesUsd), ["gibt-es-nicht"]);
  // Kontrast-Assertion: EIN Roh-Index auf denselben Proxy wirft TypeError - genau das,
  // was unpricedModels durch Object.hasOwn vermeidet (Proxy-Beleg, src/config.js get-Trap).
  assert.throws(() => config.llm.modelPricesUsd["gibt-es-nicht"], TypeError);
});
