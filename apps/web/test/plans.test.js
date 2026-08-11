// BK0 (web-Suite) — Marketing-Spiegel + Preis-Formatter, rein (kein astro-Build).
// Pinnt formatPlanPrice an den Grenzwerten (Sub-Euro, runder Euro, unbekannte
// Waehrung) und die Spiegel-Form. Bewusst self-contained: KEIN Import aus dem
// root-src - der Cross-Package-Drift-Guard (src == Spiegel) liegt im root-Test
// (test/plans-catalog.test.js, der einzige Ort, der beide Pakete sieht).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_CATALOG, formatPlanPrice } from "../src/lib/plans.js";

test("formatPlanPrice: Ganzzahl-Cents -> EUR-Anzeige (Komma-Trenner, Symbol nachgestellt)", () => {
  assert.equal(formatPlanPrice(499, "eur"), "4,99 €");
  assert.equal(formatPlanPrice(999, "eur"), "9,99 €");
  assert.equal(formatPlanPrice(99, "eur"), "0,99 €"); // Sub-Euro-Grenzwert (T5)
  assert.equal(formatPlanPrice(100, "eur"), "1,00 €"); // runder Euro, Minor-Padding
  // usd bleibt in der alten Notation (Symbol vorn, Punkt-Trenner, Deckung des verbliebenen Branches).
  assert.equal(formatPlanPrice(499, "usd"), "$4.99");
});

test("formatPlanPrice: unbekannte Waehrung -> ohne Symbol (fail-soft, kein Muell-Glyph)", () => {
  assert.equal(formatPlanPrice(499, "xyz"), "4.99");
});

test("Spiegel-Form: zwei Tiers, Ganzzahl-Cents > 0, eur", () => {
  assert.equal(PLAN_CATALOG.length, 2);
  for (const plan of PLAN_CATALOG) {
    assert.ok(Number.isInteger(plan.amountCents) && plan.amountCents > 0);
    // EUR-Cutover (Stripe live, 2026-07-03): Abrechnung + Anzeige in EUR.
    assert.equal(plan.currency, "eur");
  }
});

test("Formatter erzeugt Euro-, kein Dollar-Zeichen (Waehrungs-Vereinheitlichung)", () => {
  for (const plan of PLAN_CATALOG) {
    const price = formatPlanPrice(plan.amountCents, plan.currency);
    assert.ok(price.includes("€"), `${plan.slug}: Katalog-Preis ohne €`);
    assert.ok(!price.includes("$"), `${plan.slug}: Katalog-Preis noch mit $`);
  }
});
