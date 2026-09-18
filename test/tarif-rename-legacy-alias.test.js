// Uebergangs-Alias der Tarif-Umbenennung Business -> Pro (2026-09-15).
//
// Warum es diese Datei gibt: der Slug lebt nicht nur im Repo. Er steht in
// tenant.stripe_plan_slug und in den Stripe-Metadaten (metadata.plan_slug) der Abos, die
// zum Zeitpunkt der Umbenennung LIEFEN - und von dort kommt "business" bei jedem Webhook
// zurueck. Die Slug-Kette ist durchgehend fail-closed: isKnownPlanSlug entscheidet, ob der
// Webhook den Plan ueberhaupt uebernimmt, planCapCents WIRFT bei unbekanntem Slug, und
// planProfileFor liefert dann null (Aktivierung skippt). Ein Rename ohne Alias waere also
// kein Anzeige-Wechsel gewesen, sondern ein stiller Ausfall bezahlter Abos.
//
// Gepinnt werden die zwei Halbsaetze, die das verhindern:
//   (a) LESEKANTE: jede Nachschlage-Funktion beantwortet den alten Slug GENAUSO wie "pro"
//   (b) EINGANGSKANTE: was aus Stripe hereinkommt, wird als NEUER Slug weitergereicht -
//       der selektive Patch schreibt damit "pro" in den Store, der Bestand heilt sich
//       beim ersten Event, das ein Abo ohnehin erzeugt
//
// Diese Datei ist zugleich die Streichliste: ist der Bestand umgezogen (Schritte 1-4 in
// docs/RUNBOOK-STRIPE-LIVE.md) und faellt LEGACY_PLAN_SLUG_ALIASES, faellt sie mit.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_SLUGS,
  LEGACY_PLAN_SLUG_ALIASES,
  findPlan,
  isKnownPlanSlug,
  normalizePlanSlug,
  planProfileFor,
} from "../src/plans.js";
import { planCapCents } from "../src/billing/plan-caps.js";
import { priceIdForPlan } from "../src/billing/subscribe.js";
import { interpretStripeEvent, SUBSCRIPTION_EVENT, WEBHOOK_ACTION } from "../src/billing/webhook.js";

const ALT = "business"; // der Slug, den Bestands-Abos tragen
const NEU = "pro"; // der Katalog-Slug von heute

// Basissatz der Kopffreiheits-Rechnung. Frei gewaehlt, aber ganzzahlig - geprueft wird
// GLEICHHEIT zweier Aufrufe, nicht der Betrag selbst (der hat eigene Tests).
const CFG_CAP = Object.freeze({ voiceTariffDefaultCents: 30 });

// ---- (a) Lesekante: der alte Slug wird ueberall wie der neue beantwortet ----

test("Alias-Tabelle bildet genau den alten auf den heutigen Katalog-Slug ab", () => {
  assert.deepEqual(LEGACY_PLAN_SLUG_ALIASES, { [ALT]: NEU });
  assert.ok(CATALOG_SLUGS.includes(NEU), "Alias-Ziel muss ein Katalog-Slug sein");
  assert.ok(!CATALOG_SLUGS.includes(ALT), "der alte Slug ist KEIN Katalog-Slug mehr");
});

test("normalizePlanSlug: Alias uebersetzt, alles andere geht unveraendert durch", () => {
  assert.equal(normalizePlanSlug(ALT), NEU);
  assert.equal(normalizePlanSlug(NEU), NEU, "idempotent - der neue Slug bleibt");
  assert.equal(normalizePlanSlug("starter"), "starter");
  assert.equal(normalizePlanSlug("gold"), "gold", "unbekannt bleibt unbekannt, kein Default");
  assert.equal(normalizePlanSlug(""), "");
  assert.equal(normalizePlanSlug(null), null);
  assert.equal(normalizePlanSlug(undefined), undefined);
});

test("normalizePlanSlug faellt nicht auf den Object-Prototyp herein", () => {
  // Ohne Object.hasOwn lieferte ein nackter Zugriff hier eine FUNKTION statt eines Strings
  // (und "__proto__" das Prototyp-Objekt) - beides waere Muell im weiteren Slug-Pfad.
  for (const falle of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(normalizePlanSlug(falle), falle, `${falle} muss unveraendert durchgehen`);
    assert.equal(isKnownPlanSlug(falle), false, `${falle} ist kein buchbarer Tarif`);
  }
});

test("isKnownPlanSlug: ein Bestands-Abo ist ein BEKANNTER Plan", () => {
  assert.equal(isKnownPlanSlug(ALT), true, "sonst verwirft der Webhook seinen eigenen Kunden");
  assert.equal(isKnownPlanSlug(NEU), true);
  assert.equal(isKnownPlanSlug("gold"), false, "der Riegel gegen echte Fremd-Slugs bleibt zu");
});

test("findPlan: alter Slug liefert denselben Katalog-Eintrag wie der neue", () => {
  const ueberAlt = findPlan(ALT);
  assert.equal(ueberAlt, findPlan(NEU), "dasselbe eingefrorene Objekt, keine Kopie");
  assert.equal(ueberAlt?.slug, NEU, "nach aussen traegt der Eintrag nur noch den neuen Slug");
  assert.equal(ueberAlt?.name, "Pro");
});

test("planProfileFor: alter Slug behaelt sein bezahltes Rechteprofil", () => {
  // Faellt das auf null, skippt die Aktivierung fail-closed - der zahlende Tenant landete
  // auf dem nicht-provisionierten DEFAULT (0 Calls/h) und koennte nicht mehr telefonieren.
  assert.equal(planProfileFor(ALT), planProfileFor(NEU));
  assert.notEqual(planProfileFor(ALT), null);
  assert.equal(planProfileFor("gold"), null, "fail-closed fuer echte Fremd-Slugs bleibt");
});

test("planCapCents: alter Slug bekommt dieselbe Kostendecke, statt zu werfen", () => {
  // Der Wurf liefe im Webhook-Pfad als unhandled rejection durch (kein try/catch um
  // applyStripeWebhookSerialized) - haengende Antwort, Stripe-Timeout.
  assert.equal(planCapCents(ALT, CFG_CAP), planCapCents(NEU, CFG_CAP));
  assert.throws(() => planCapCents("gold", CFG_CAP), /unbekannter Plan-Slug/);
});

test("priceIdForPlan: alter Slug loest auf denselben Stripe-Price auf", () => {
  // Umbenannt wurde das Stripe-PRODUKT, nicht der Price - die price_-Id ist unveraendert.
  const config = { billing: { stripeStarterPriceId: "price_starter", stripeProPriceId: "price_pro" } };
  assert.equal(priceIdForPlan(ALT, config), "price_pro");
  assert.equal(priceIdForPlan(NEU, config), "price_pro");
  assert.equal(priceIdForPlan("gold", config), null);
});

// ---- (b) Eingangskante: was hereinkommt, geht als NEUER Slug weiter ----

function aboEvent(planSlug) {
  return {
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_alias",
        status: "active",
        current_period_end: 1893456000,
        metadata: { tenant_ref: "t_alias", plan_slug: planSlug },
      },
    },
  };
}

test("interpretStripeEvent normalisiert den Slug aus der Stripe-Metadata", () => {
  const ausBestand = interpretStripeEvent(aboEvent(ALT));
  assert.equal(ausBestand.action, WEBHOOK_ACTION.ACTIVATE);
  assert.equal(ausBestand.planSlug, NEU, "der Store bekommt den NEUEN Slug - Bestand heilt sich");
  assert.equal(interpretStripeEvent(aboEvent(NEU)).planSlug, NEU, "idempotent");
});

test("interpretStripeEvent laesst fehlenden und fremden Slug unveraendert", () => {
  // null = selektiver Patch (gespeicherter Slug bleibt); ein echter Fremd-Slug muss
  // FREMD bleiben, damit der fail-closed-Riegel in applyStripeWebhook ihn abweist.
  const ohneSlug = interpretStripeEvent({
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: { object: { id: "sub_x", status: "active", metadata: { tenant_ref: "t_x" } } },
  });
  assert.equal(ohneSlug.planSlug, null);
  assert.equal(interpretStripeEvent(aboEvent("gold")).planSlug, "gold");
});

// ---- (c) Env-Rueckfall: der Deploy bleibt gruen, bevor Render umgestellt ist ----

test("config liest den alten Env-Namen, solange der neue fehlt", async () => {
  // Der Gateway deployt vor dem Env-Umzug (Schritt 3 im Runbook). Ohne diesen Rueckfall
  // stuende der Katalog-Slug pro ohne Stripe-Price da und boot.js#assertPricedPlans
  // beendete den Start mit exit 1 - der Dienst waere nach dem Deploy schlicht weg.
  // Die Env wird VOR dem dynamischen Import gesetzt; diese Testdatei laeuft in einem
  // eigenen Prozess (node --test), die Zuweisung faellt also niemandem sonst zu.
  process.env.STRIPE_PRO_PRICE_ID = "";
  process.env.STRIPE_BUSINESS_PRICE_ID = "price_noch_aus_render";
  const { config } = await import("../src/config.js");
  assert.equal(config.billing.stripeProPriceId, "price_noch_aus_render");
});
