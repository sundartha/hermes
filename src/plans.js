// Plan-Katalog = Single Source of Truth fuer die buchbaren Tarife (Preise +
// Leistungen). Reines Daten-Modul: KEINE Imports, kein config, kein IO -> kein
// Lazy-Init (P15), keine Kopplung. Wird vom oeffentlichen GET /api/plans
// geliefert und von der Slug-Quelle in billing/subscribe.js konsumiert.
//
// SPIEGEL-PFLICHT (Deploy-Isolation): apps/web/src/lib/plans.js ist eine 1:1-
// physische Kopie dieser Daten. Grund: render.yaml deployt den Gateway-Service
// nur bei src/-Commits und die Static-Site (hermes-web) nur bei apps/web/-
// Commits (eigene Lockfile, eigenes npm-Paket). EIN importierter File koennte
// nie beide Services deployen -> ein Preis-Edit liesse die Marketing-Seite stale.
// Divergenz der beiden Kopien ist ein roter Build (test/plans-catalog.test.js).
//
// amountCents = der ANGEZEIGTE Preis (Ganzzahl Cents, G26 - kein Float). Der
// tatsaechliche Abbuch laeuft ueber den Stripe-Price (STRIPE_*_PRICE_ID); ihre
// Uebereinstimmung ist Owner-Verantwortung - dieser Katalog liest Stripe NICHT.
export const PLAN_CATALOG = Object.freeze([
  Object.freeze({
    slug: "starter",
    name: "Starter",
    amountCents: 499,
    currency: "eur",
    cadence: "month",
    includedMinutes: 30,
    numberCount: 1,
    featured: false,
    features: Object.freeze([
      "30 minutes of calls per month",
      "1 phone number",
      "Answer and summarise calls",
      "Call history in your area",
    ]),
  }),
  Object.freeze({
    slug: "business",
    name: "Business",
    amountCents: 999,
    currency: "eur",
    cadence: "month",
    includedMinutes: 120,
    numberCount: 1,
    featured: true,
    features: Object.freeze([
      "120 minutes of calls per month",
      "1 phone number",
      "Outgoing calls on your behalf",
      "Priority support",
    ]),
  }),
]);

// Buchbare Slugs in Katalog-Reihenfolge (eingefroren). EINE Quelle fuer
// billing/subscribe.js (PLAN_SLUGS) - kein zweites Slug-Literal (G5/S2).
export const CATALOG_SLUGS = Object.freeze(PLAN_CATALOG.map((p) => p.slug));

// Kern-Praedikat: ist `slug` ein buchbarer Katalog-Slug? EINE Quelle der
// Mitgliedschaftspruefung (G5/S2) - vier Aufrufstellen (subscribe.js, webhook.js,
// state-ops.js, self-service-routes.js) teilen sie sich, JEDE behaelt aber ihre
// eigene Reaktion (throw / soft-ignore+audit / reject-Objekt / null) und ihr eigenes
// null/leer-Handling. Reine Mitgliedschaft: null/undefined/leer -> false (Array.includes
// matcht sie nicht) - identisch zum vorher an jeder Stelle inline geschriebenen
// CATALOG_SLUGS.includes(slug), nur nicht mehr dupliziert.
export function isKnownPlanSlug(slug) {
  return CATALOG_SLUGS.includes(slug);
}

// Katalog-Lookup nach Slug (BK4: includedMinutes der Minuten-Kontingent-Anzeige).
// Reiner Accessor - kapselt, dass der Katalog ein Array ist (G17/G36), kein .find
// verstreut beim Aufrufer. Unbekannter/leerer Slug -> null (Aufrufer zeigt Leerzustand).
export function findPlan(slug) {
  return PLAN_CATALOG.find((p) => p.slug === slug) ?? null;
}

// ---- Plan -> Rechteprofil (GAP A, Phase A1; reines Datenmodul, KEIN Konsument) ----
// Bildet einen buchbaren Plan-Slug auf das VOLLSTAENDIGE Rechteprofil ab, das die
// Aktivierung (A2) spaeter via setProfile auf die tenantId setzt (Phase S). Traegt JEDES
// PROFILE_FIELDS-Feld EXPLIZIT - ein fehlendes Feld fiele in resolveProfileFrom still
// auf den restriktiven DEFAULT_PROFILE-Wert zurueck (A11) und unterliefe das Tier-Recht.
//
// 5.1 (Owner, 2026-06-29): starter und business tragen IDENTISCHE Rechte - sie
// unterscheiden sich NUR in includedMinutes (GAP B), NICHT im Profil. Daher EIN
// gemeinsames Profil-Objekt (G5: keine Wert-Duplizierung), beide Slugs zeigen darauf.
// Das Plan-Profil hat genau eine Funktion: Outbound ueberhaupt freischalten (paid)
// gegenueber dem nicht-provisionierten DEFAULT (A4: 0 Calls/h). Deshalb bewusst:
//   unrestricted=false       - KEIN Verifikations-Gate-Freibrief (Toll-Fraud-Flaeche)
//   allowedNumbers=[]        - KEINE eigene Ziel-Freigabe (Toll-Fraud-Flaeche)
//   allowedCountryCodes=[]   - kein per-Profil-Land-Freibrief; globales Land-Gate bleibt
//                              Schnittmenge (so restriktiv wie heute)
//   allowCalendar/Booking=false - Funktion bewusst verworfen
//   allowConsult=false       - AL-P13: der Consult-Kanal bleibt eine Owner-Faehigkeit,
//                              bis die Abnahme durch ist (kein Plan-Freibrief)
//   allowLookup=false        - AL-P10b: dasselbe fuer den In-Call-Nachschlag (er bringt
//                              einen ZWEITEN Auftragsverarbeiter mit)
//   maxCallsPerHour=null     - keine Profil-Senkung; faellt auf den Pro-Tenant-Default
//                              config.safety.maxCallsPerHour (telephony/outbound-gates.js
//                              tenantHourReached). Minuten-Quota (GAP B) + Budget sind die
//                              echten Deckel.
//
// KOPPLUNG A2: sanitizeProfile (defaults.js) droppt maxCallsPerHour=null heute (typeof
// null === "object" != "number") -> A2 muss sanitizeProfile null-tolerant machen, BEVOR
// es dieses Profil via setProfile speichert (sonst greift A11). Hier - reines Datenmodul,
// kein Konsument, byte-identisch - bleibt sanitizeProfile unberuehrt.
//
// SERVER-only: KEINE Spiegelung nach apps/web/src/lib/plans.js (Rechte sind kein
// Marketing-Datum; der Cross-Package-Drift-Guard vergleicht NUR PLAN_CATALOG).
const PAID_PLAN_PROFILE = Object.freeze({
  allowedNumbers: Object.freeze([]),
  allowedCountryCodes: Object.freeze([]),
  unrestricted: false,
  allowCalendar: false,
  // AL-P13: Consult-Kanal ist eine Owner-Faehigkeit bis die Abnahme (10 echte
  // place_call aus claude.ai + 5 aus ChatGPT, O9) durch ist - kein Plan-Freibrief.
  allowConsult: false,
  // AL-P10b: der Nachschlag bleibt eine Owner-Faehigkeit, bis Testanruf und
  // Datenschutzerklaerung durch sind (zweiter Auftragsverarbeiter) - kein Plan-Freibrief.
  allowLookup: false,
  allowBooking: false,
  maxCallsPerHour: null,
});

// planSlug -> vollstaendiges Tier-Profil. Eingefroren; unbekannter Slug fehlt hier
// (planProfileFor -> null = fail-closed). Vollstaendigkeit je Katalog-Slug ist
// test-gepinnt (test/plan-profile.test.js gegen CATALOG_SLUGS + PROFILE_FIELDS).
export const PLAN_PROFILE = Object.freeze({
  starter: PAID_PLAN_PROFILE,
  business: PAID_PLAN_PROFILE,
});

// Tier-Profil nach Slug (Geschwister zu findPlan, gleiche ?? null-Konvention, G11).
// Unbekannter/leerer Slug -> null: der Aufrufer (A2-Aktivierung) SKIPt fail-closed
// statt setProfile(tenantId, undefined) zu schreiben (symmetrisch zu B2 "kein Plan -> blocken").
export function planProfileFor(slug) {
  return PLAN_PROFILE[slug] ?? null;
}
