import { test } from "node:test";
import assert from "node:assert/strict";
import { spendCapCoherence, unpricedModels, SPEND_CAP_FINDING } from "../src/boot-guard.js";
import { config } from "../src/config.js";
import { PRICES } from "./_prices.js";

test("KS-P9: Tenant-Default >= Plattform-Zahl ist kein Befund mehr", () => {
  assert.deepEqual(
    spendCapCoherence({
      tenantDefaultCents: 1000,
      platformCapCents: 800,
      maxTariffCents: 300,
    }),
    [],
    "1000 >= 800 war T-P3-01 (FATAL), ist jetzt befundfrei",
  );
  assert.deepEqual(
    spendCapCoherence({
      tenantDefaultCents: 900,
      platformCapCents: 900,
      maxTariffCents: 300,
    }),
    [],
    "Gleichstand war T-P3-02 (FATAL), ist jetzt befundfrei",
  );
});

test("T-P3-03: knapp unter dem Cap, kein Tarif -> kein fataler Befund", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 799,
    platformCapCents: 800,
    maxTariffCents: 0,
  });
  assert.equal(findings.some((f) => f.fatal), false);
});

test("T-P3-04: Sentinel 0 -> A0-WARN, nie fatal, Klausel B feuert bei Default 0 nicht", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 0,
    platformCapCents: 800,
    maxTariffCents: 300,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, SPEND_CAP_FINDING.TENANT_DEFAULT_UNSET);
});

test("T-P3-05: Worst-Case-Reserve (400*2=800) > Tenant-Decke 700 -> genau ein FATAL, nennt die tragbare Dauer", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 700,
    platformCapCents: 1200,
    maxTariffCents: 400,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.equal(findings[0].code, SPEND_CAP_FINDING.WORST_CASE_UNAFFORDABLE);
  assert.match(findings[0].message, /nur noch 60s Gespraech/);
  assert.match(findings[0].message, /mindestens 800/);
});

test("T-P3-06: Worst-Case-Reserve unter der Tenant-Decke -> kohaerent, [] ", () => {
  const findings = spendCapCoherence({
    tenantDefaultCents: 2000,
    platformCapCents: 5000,
    maxTariffCents: 300,
  });
  assert.deepEqual(findings, []);
});

test("KS-P3: 800/300 ist seit der Entkopplung kohaerent (im Bestand FATAL)", () => {
  assert.deepEqual(
    spendCapCoherence({ tenantDefaultCents: 800, platformCapCents: 1200, maxTariffCents: 300 }),
    [],
  );
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

test("T-P3-09: unpricedModels wirft NICHT auf der echten config-Oberflaeche (Proxy-Trap-Kontrast)", () => {
  const [known] = Object.keys(config.llm.modelPricesUsd);
  assert.ok(known, "Preistabelle darf nicht leer sein");
  assert.doesNotThrow(() => unpricedModels([known, "gibt-es-nicht"], config.llm.modelPricesUsd));
  assert.deepEqual(unpricedModels([known, "gibt-es-nicht"], config.llm.modelPricesUsd), ["gibt-es-nicht"]);
  assert.throws(() => config.llm.modelPricesUsd["gibt-es-nicht"], TypeError);
});
