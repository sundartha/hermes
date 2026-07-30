// P3 (Boot-Guards Konfig-Kohaerenz/Modellpreise): reine, arg-injizierte Wahrheitstabellen
// fuer spendCapCoherence + unpricedModels (Muster fakeOriginateBootBlocked/meterMappingGaps
// in test/boot-guard.test.js). Kein Spawn, kein Netz - F.I.R.S.T.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spendCapCoherence, unpricedModels, SPEND_CAP_FINDING } from "../src/boot-guard.js";
import { config } from "../src/config.js";
import { PRICES } from "./_prices.js";

// KS-P9/E10: Klausel A (Tenant-Default >= Plattform-Zahl -> FATAL "Tenant-Achse inert") ist
// ersatzlos entfallen - die Plattform-Achse bindet nicht mehr zuerst, also kann sie die
// Tenant-Achse auch nicht mehr inert machen. Der frueher fatale Vektor ist jetzt befundfrei,
// solange Klausel B (Worst-Case-Reserve gegen die TENANT-Decke) haelt.
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

// P7/GAP-32: derselbe Befund, seit dem Flip FATAL. Die Meldung muss den Zielwert nennen -
// der Betreiber soll ohne Raten ablesen koennen, worauf er die Decke anheben muss.
// KS-P3 (a): die Reserve ist Satz * RESERVE_LEAD_MINUTES (400*2 = 800 > Decke 700); die
// Dauer geht nicht mehr ein. Die Diagnose nennt weiterhin, wie lange ein Gespraech unter
// dieser Decke ueberhaupt noch traegt (floor(700/400) = 1 Minute = 60s).
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

// KS-P3 (a), Mutationsprobe-Anker: dieselbe Eingabe, die im Bestand FATAL war (Reserve
// 300*ceil(180/60) = 900 > Decke 800), ist jetzt kohaerent (300*2 = 600 <= 800). Das ist
// die Verhaltensaenderung dieser Phase, ausdruecklich gepinnt statt stillschweigend.
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
