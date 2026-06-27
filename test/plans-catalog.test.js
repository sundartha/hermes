// BK0 — Plan-Katalog als Single Source of Truth. Pinnt die Katalog-Daten (Spec-
// Werte), die referenzielle EINE-Slug-Quelle (subscribe.js teilt CATALOG_SLUGS),
// die Slug<->Stripe-Price-Coverage und den Cross-Package-Drift gegen den
// Marketing-Spiegel. Dieser root-Test ist der EINZIGE Ort, der beide npm-Pakete
// sieht (src/plans.js + apps/web/src/lib/plans.js) - genau dafuer da: Divergenz
// der zwei physischen Kopien (Deploy-Isolation) wird hier zum roten Build.
import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_CATALOG, CATALOG_SLUGS } from "../src/plans.js";
import { PLAN_SLUGS, priceIdForPlan } from "../src/billing/subscribe.js";
import { PLAN_CATALOG as WEB_CATALOG } from "../apps/web/src/lib/plans.js";

const EXPECTED_SLUGS = ["starter", "business"];

test("Katalog hat genau die zwei Spec-Tiers in Reihenfolge", () => {
  assert.equal(PLAN_CATALOG.length, 2);
  assert.deepEqual([...CATALOG_SLUGS], EXPECTED_SLUGS);
});

test("jeder Plan: Ganzzahl-Cents > 0, usd, ganzzahlige Mengen > 0", () => {
  for (const plan of PLAN_CATALOG) {
    assert.ok(
      Number.isInteger(plan.amountCents) && plan.amountCents > 0,
      `${plan.slug}: amountCents keine positive Ganzzahl`,
    );
    assert.equal(plan.currency, "usd", `${plan.slug}: currency != usd`);
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
  assert.equal(PLAN_SLUGS, CATALOG_SLUGS); // referenzielle Identitaet, nicht nur gleich
  assert.deepEqual([...PLAN_SLUGS], EXPECTED_SLUGS);
});

test("jeder Katalog-Slug hat einen aufloesbaren Stripe-Price-Config-Key", () => {
  // Faengt 'neuer Tier ohne Price-Config-Key' ab: priceIdForPlan muss fuer JEDEN
  // buchbaren Slug bei gesetzter Config eine Price-Id liefern (sonst Tier tot).
  const config = { stripeStarterPriceId: "price_s", stripeBusinessPriceId: "price_b" };
  for (const slug of CATALOG_SLUGS) {
    assert.ok(priceIdForPlan(slug, config), `${slug}: kein Stripe-Price-Config-Key`);
  }
});

test("Cross-Package-Drift: Marketing-Spiegel ist 1:1 zum Backend-Katalog", () => {
  // Der einzige Ort, der beide Pakete importiert. Divergenz der physischen Kopien
  // (Deploy-Isolation: getrennte Render-Services) ist hier ein roter Build.
  assert.deepEqual(WEB_CATALOG, PLAN_CATALOG);
});

// BK1: die Dashboard-Kacheln rendern features[] (Leistungsliste) + GENAU eine Popular-
// Markierung. Pinnt die Daten, auf die sich die In-App-Pricing-Ansicht verlaesst
// (GET /api/plans gibt PLAN_CATALOG verbatim zurueck).
test("Katalog traegt die Kachel-Render-Daten: features[] nichtleer, genau ein featured", () => {
  for (const plan of PLAN_CATALOG) {
    assert.ok(Array.isArray(plan.features) && plan.features.length > 0, `${plan.slug}: features leer`);
  }
  assert.equal(PLAN_CATALOG.filter((p) => p.featured).length, 1, "genau ein featured (Popular)");
});
