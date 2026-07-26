// GAP-32 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-32"), in P7
// behoben. Befund war: ein unbezahlbarer Worst-Case-Tarif brach den Start nicht ab,
// sondern warnte nur - die Zeile stand seit dem ersten Deploy folgenlos im Log, waehrend
// jedes Ziel ohne gemessenen Inlandssatz vor dem Dial abgewiesen wurde.
//
// R5-Korrektur in P7: die frueheren render.yaml-IST-Pins (600/800/300) sind GELOESCHT -
// sie pinnten exakt die Inkohaerenz, die P7 beseitigt hat (die ausgelieferten Zahlen loesen
// den Befund nicht mehr aus; DASS sie kohaerent sind, prueft
// test/env-docs-spend-cap-coherence.test.js gegen alle drei Quellen). Die SOLL-Assertion
// steht woertlich und faehrt gegen KONSTRUIERTE Zahlen.
//
// A3: der Testname traegt die Katalog-ID nicht mehr am Anfang -> der jetzt gruene Test
// liegt im Regressionslauf (npm test), nicht mehr im Launch-Gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spendCapCoherence, SPEND_CAP_FINDING } from "../src/boot-guard.js";

// Konstruiert, NICHT gemessen: platformCapCents liegt bewusst ueber der Tenant-Decke,
// damit Klausel A nicht vorher greift und wirklich Klausel B geprueft wird.
const UNAFFORDABLE = Object.freeze({
  tenantDefaultCents: 600,
  platformCapCents: 3000,
  maxTariffCents: 300,
  maxCallDurationS: 300, // -> Reserve 300 * 5 = 1500 ct > Decke 600 ct
});

test("Boot-Guard (GAP-32): ein unbezahlbarer Worst-Case-Tarif bricht den Start ab (fatal:true)", () => {
  const worstCase = spendCapCoherence(UNAFFORDABLE).find(
    (f) => f.code === SPEND_CAP_FINDING.WORST_CASE_UNAFFORDABLE,
  );
  assert.ok(worstCase, "konstruierte Eingabe muss den Befund ausloesen");
  assert.equal(
    worstCase.fatal,
    true,
    "SOLL: ein Worst-Case-Tarif, der die Tenant-Decke sprengt, muss den Start abbrechen - " +
      "unter dieser Konfiguration ist der Dienst fuer einen ganzen Zielbereich abgeschaltet",
  );
  assert.match(worstCase.message, /DEFAULT_TENANT_BUDGET_CENTS=600/);
  assert.match(worstCase.message, /VOICE_TARIFF_DEFAULT_CENTS=300/);
  assert.match(worstCase.message, /1500 Cent/);
  assert.match(worstCase.message, /mindestens 1500/);
});
