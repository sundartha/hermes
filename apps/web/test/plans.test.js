import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_CATALOG, formatPlanPrice } from "../src/lib/plans.js";

const SUB_EURO_CENTS = 99;
const ROUND_EURO_CENTS = 100;
const STARTER_CENTS = 499;
const BUSINESS_CENTS = 999;

test("formatPlanPrice: Ganzzahl-Cents -> EUR-Anzeige (Komma-Trenner, Symbol nachgestellt)", () => {
  assert.equal(formatPlanPrice(499, "eur"), "4,99 €");
  assert.equal(formatPlanPrice(999, "eur"), "9,99 €");
  assert.equal(formatPlanPrice(99, "eur"), "0,99 €");
  assert.equal(formatPlanPrice(100, "eur"), "1,00 €");
  assert.equal(formatPlanPrice(499, "usd"), "$4.99");
});

test("formatPlanPrice: lang=en -> englische Notation (Punkt-Trenner, Symbol vorangestellt)", () => {
  assert.equal(formatPlanPrice(STARTER_CENTS, "eur", "en"), "€4.99");
  assert.equal(formatPlanPrice(BUSINESS_CENTS, "eur", "en"), "€9.99");
  assert.equal(formatPlanPrice(SUB_EURO_CENTS, "eur", "en"), "€0.99");
  assert.equal(formatPlanPrice(ROUND_EURO_CENTS, "eur", "en"), "€1.00");
  assert.equal(formatPlanPrice(STARTER_CENTS, "eur", "de"), "4,99 €");
  assert.equal(formatPlanPrice(STARTER_CENTS, "eur"), "4,99 €");
});

test("formatPlanPrice: unbekannte Waehrung -> ohne Symbol (fail-soft, kein Muell-Glyph)", () => {
  assert.equal(formatPlanPrice(499, "xyz"), "4.99");
});

test("Spiegel-Form: zwei Tiers, Ganzzahl-Cents > 0, eur", () => {
  assert.equal(PLAN_CATALOG.length, 2);
  for (const plan of PLAN_CATALOG) {
    assert.ok(Number.isInteger(plan.amountCents) && plan.amountCents > 0);
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
