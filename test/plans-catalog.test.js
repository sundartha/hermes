import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_CATALOG, CATALOG_SLUGS } from "../src/plans.js";
import { PLAN_SLUGS, priceIdForPlan } from "../src/billing/subscribe.js";
import { PLAN_CATALOG as WEB_CATALOG } from "../apps/web/src/lib/plans.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const EXPECTED_SLUGS = ["starter", "business"];

test("Katalog hat genau die zwei Spec-Tiers in Reihenfolge", () => {
  assert.equal(PLAN_CATALOG.length, 2);
  assert.deepEqual([...CATALOG_SLUGS], EXPECTED_SLUGS);
});

test("jeder Plan: Ganzzahl-Cents > 0, eur, ganzzahlige Mengen > 0", () => {
  for (const plan of PLAN_CATALOG) {
    assert.ok(
      Number.isInteger(plan.amountCents) && plan.amountCents > 0,
      `${plan.slug}: amountCents keine positive Ganzzahl`,
    );
    assert.equal(plan.currency, "eur", `${plan.slug}: currency != eur`);
    assert.ok(
      Number.isInteger(plan.includedMinutes) && plan.includedMinutes > 0,
      `${plan.slug}: includedMinutes keine positive Ganzzahl`,
    );
    assert.ok(
      Number.isInteger(plan.numberCount) && plan.numberCount > 0,
      `${plan.slug}: numberCount keine positive Ganzzahl`,
    );
  }
});

test("konkrete Spec-Betraege: starter 499, business 999", () => {
  const bySlug = Object.fromEntries(PLAN_CATALOG.map((p) => [p.slug, p.amountCents]));
  assert.equal(bySlug.starter, 499);
  assert.equal(bySlug.business, 999);
});

test("subscribe.js teilt referenziell DIESELBE Slug-Quelle (eine Quelle, G5/S2)", () => {
  assert.equal(PLAN_SLUGS, CATALOG_SLUGS);
  assert.deepEqual([...PLAN_SLUGS], EXPECTED_SLUGS);
});

test("jeder Katalog-Slug hat einen aufloesbaren Stripe-Price-Config-Key", () => {
  const config = withConfigNamespaces({ stripeStarterPriceId: "price_s", stripeBusinessPriceId: "price_b" });
  for (const slug of CATALOG_SLUGS) {
    assert.ok(priceIdForPlan(slug, config), `${slug}: kein Stripe-Price-Config-Key`);
  }
});

test("Cross-Package-Drift: Marketing-Spiegel ist 1:1 zum Backend-Katalog", () => {
  assert.deepEqual(WEB_CATALOG, PLAN_CATALOG);
});

test("Katalog traegt die Kachel-Render-Daten: features[] nichtleer, genau ein featured", () => {
  for (const plan of PLAN_CATALOG) {
    assert.ok(Array.isArray(plan.features) && plan.features.length > 0, `${plan.slug}: features leer`);
  }
  assert.equal(PLAN_CATALOG.filter((p) => p.featured).length, 1, "genau ein featured (Popular)");
});
