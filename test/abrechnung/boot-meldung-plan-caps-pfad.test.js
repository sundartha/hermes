import { test } from "node:test";
import assert from "node:assert/strict";

import { planCapReserveFindings, planCapUnderivableFindings } from "../../src/boot-guard.js";

const CAP_CENTS = 300;
const TARIFF_CENTS = 400;

function capForSlugThatThrows() {
  throw new Error("kein Katalog-/Kopffreiheit-Eintrag");
}

test("Boot-Meldung ohne ableitbare Kostendecke verweist auf die vorhandene Datei plan-caps.ts", () => {
  const [finding] = planCapUnderivableFindings({ slugs: ["starter"], capForSlug: capForSlugThatThrows });
  assert.match(finding.message, /PLAN_CAP_HEADROOM, src\/billing\/plan-caps\.ts\)/);
  assert.doesNotMatch(finding.message, /plan-caps\.js/);
});

test("Boot-Meldung zur Worst-Case-Reserve verweist auf die vorhandene Datei plan-caps.ts", () => {
  const [finding] = planCapReserveFindings({
    slugs: ["starter"],
    capForSlug: () => CAP_CENTS,
    maxTariffCents: TARIFF_CENTS,
  });
  assert.match(finding.message, /\(src\/plans\.js, src\/billing\/plan-caps\.ts\)\.$/);
  assert.doesNotMatch(finding.message, /plan-caps\.js/);
});
