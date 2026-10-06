import { test } from "node:test";
import assert from "node:assert/strict";
import { spendCapCoherence, SPEND_CAP_FINDING } from "../src/boot-guard.js";

const UNAFFORDABLE = Object.freeze({
  tenantDefaultCents: 600,
  platformCapCents: 3000,
  maxTariffCents: 400,
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
  assert.match(worstCase.message, /VOICE_TARIFF_DEFAULT_CENTS=400/);
  assert.match(worstCase.message, /800 Cent/);
  assert.match(worstCase.message, /mindestens 800/);
});
