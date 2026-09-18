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
    slug: "pro",
    name: "Pro",
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

// ---- Uebergangs-Alias: alter Slug -> heutiger Katalog-Slug (Umbenennung 2026-09-15) ----
// Der zweite Tarif hiess bis zum 15.09.2026 "Business" und trug den Slug "business".
// Umbenannt wurde er, weil "Starter/Business" keine Stufenreihe ergibt (Einstieg vs.
// Kundensegment) - "Starter/Pro" liest sich als Reihe und bleibt nach oben offen.
//
// Der Slug lebt aber nicht nur hier: er steht in tenant.stripe_plan_slug, in den
// Stripe-Metadaten laufender Abos (metadata.plan_slug) und kommt von dort bei JEDEM
// Webhook zurueck. Kennte der Katalog ihn nicht mehr, liefe die fail-closed-Kette gegen
// die eigenen Bestandskunden: isKnownPlanSlug -> der Webhook verwirft den planSlug
// (billing/webhook.js), planCapCents WIRFT (billing/plan-caps.js), planProfileFor
// liefert null -> die Aktivierung skippt. Ein Rename ohne diesen Alias waere also kein
// Anzeige-Wechsel, sondern ein stiller Ausfall bezahlter Abos.
//
// Deshalb die Arbeitsteilung: JEDE Lesekante normalisiert (die drei Funktionen unten,
// plan-caps.js, subscribe.js), und JEDE Eingangskante speichert bereits normalisiert
// (billing/webhook.js planSlugOf, self-service-routes.js planSlugFrom). Der Bestand
// heilt sich damit von selbst, sobald ein Abo einmal durch einen Webhook laeuft.
//
// ENTFERNEN, sobald aus Stripe kein "business" mehr zurueckkommt - der Bestandsumzug
// steht in docs/RUNBOOK-STRIPE-LIVE.md. Mit dem Alias faellt auch der Env-Rueckfall
// STRIPE_BUSINESS_PRICE_ID in config.js.
export const LEGACY_PLAN_SLUG_ALIASES = Object.freeze({
  business: "pro",
});

// Alter Slug -> Katalog-Slug; alles andere geht unveraendert durch (auch null/undefined/
// leer - die Mitgliedschaftspruefung faellt danach ohnehin auf false). Object.hasOwn statt
// eines nackten Zugriffs, damit ein Slug wie "constructor" den Object-Prototyp nicht
// trifft und eine Funktion statt eines Strings zurueckgibt.
export function normalizePlanSlug(slug) {
  return Object.hasOwn(LEGACY_PLAN_SLUG_ALIASES, slug) ? LEGACY_PLAN_SLUG_ALIASES[slug] : slug;
}

// Kern-Praedikat: ist `slug` ein buchbarer Katalog-Slug? EINE Quelle der
// Mitgliedschaftspruefung (G5/S2) - vier Aufrufstellen (subscribe.js, webhook.js,
// state-ops.js, self-service-routes.js) teilen sie sich, JEDE behaelt aber ihre
// eigene Reaktion (throw / soft-ignore+audit / reject-Objekt / null) und ihr eigenes
// null/leer-Handling. Reine Mitgliedschaft: null/undefined/leer -> false (Array.includes
// matcht sie nicht) - identisch zum vorher an jeder Stelle inline geschriebenen
// CATALOG_SLUGS.includes(slug), nur nicht mehr dupliziert.
// Normalisiert zuerst (LEGACY_PLAN_SLUG_ALIASES): ein Bestands-Abo, das noch den alten
// Slug traegt, ist ein BEKANNTER Plan - sonst verwuerfe der Webhook seinen eigenen Kunden.
export function isKnownPlanSlug(slug) {
  return CATALOG_SLUGS.includes(normalizePlanSlug(slug));
}

// Katalog-Lookup nach Slug (BK4: includedMinutes der Minuten-Kontingent-Anzeige).
// Reiner Accessor - kapselt, dass der Katalog ein Array ist (G17/G36), kein .find
// verstreut beim Aufrufer. Unbekannter/leerer Slug -> null (Aufrufer zeigt Leerzustand).
// Normalisiert zuerst, damit ein Bestands-Slug denselben Katalog-Eintrag findet - sonst
// zeigte die Kontingent-Anzeige eines laufenden Abos einen Leerzustand statt 120 Minuten.
export function findPlan(slug) {
  const canonical = normalizePlanSlug(slug);
  return PLAN_CATALOG.find((p) => p.slug === canonical) ?? null;
}

// ---- Plan -> Rechteprofil (GAP A, Phase A1; reines Datenmodul, KEIN Konsument) ----
// Bildet einen buchbaren Plan-Slug auf das VOLLSTAENDIGE Rechteprofil ab, das die
// Aktivierung (A2) spaeter via setProfile auf die tenantId setzt (Phase S). Traegt JEDES
// PROFILE_FIELDS-Feld EXPLIZIT - ein fehlendes Feld fiele in resolveProfileFrom still
// auf den restriktiven DEFAULT_PROFILE-Wert zurueck (A11) und unterliefe das Tier-Recht.
//
// 5.1 (Owner, 2026-06-29): starter und pro tragen IDENTISCHE Rechte - sie
// unterscheiden sich NUR in includedMinutes (GAP B), NICHT im Profil. Daher EIN
// gemeinsames Profil-Objekt (G5: keine Wert-Duplizierung), beide Slugs zeigen darauf.
// Das Plan-Profil hat genau eine Funktion: Outbound ueberhaupt freischalten (paid)
// gegenueber dem nicht-provisionierten DEFAULT (A4: 0 Calls/h). Deshalb bewusst:
//   unrestricted=false       - KEIN Verifikations-Gate-Freibrief (Toll-Fraud-Flaeche)
//   allowedNumbers=[]        - KEINE eigene Ziel-Freigabe (Toll-Fraud-Flaeche)
//   allowedCountryCodes=[]   - kein per-Profil-Land-Freibrief; globales Land-Gate bleibt
//                              Schnittmenge (so restriktiv wie heute)
//   allowCalendar/Booking=false - Funktion bewusst verworfen
//   allowConsult=true        - Owner-Entscheidung 2026-08-11: Kernfunktion des Produkts,
//                              fuer alle Plaene freigeschaltet (kein Owner-Vorbehalt mehr)
//   allowLookup=true         - Owner-Entscheidung 2026-08-11 (P6 Werkzeugwahl): der
//                              In-Call-Nachschlag ist fuer beide bezahlten Tarife frei.
//                              Der ZWEITE Auftragsverarbeiter (Exa) bleibt bewusst
//                              akzeptiert, s. Kommentar am Feld
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
  // Owner-Entscheidung 2026-08-11: der Consult-Kanal ist Kernfunktion des
  // Produkts und steht ab sofort allen Plaenen offen. Der Rueckfrage-Kanal ist
  // das, wofuer der Assistent gebaut ist - er fragt waehrend des Anrufs beim
  // Auftraggeber nach, statt das Gespraech scheitern zu lassen.
  allowConsult: true,
  // Owner-Entscheidung 2026-08-11 (P6 der Werkzeugwahl-Kette): der In-Call-Nachschlag
  // steht beiden bezahlten Tarifen offen. Der Vorbehalt aus AL-P10b ("bis Testanruf und
  // Datenschutzerklaerung durch sind") ist damit aufgehoben; die Datenschutzfrage traegt
  // der Owner ausdruecklich selbst.
  //
  // BEWUSST AKZEPTIERTE RESTFLAECHE (Owner-Entscheidung, s. PLAN-SECURITY.md): Exa ist ein
  // zweiter Auftragsverarbeiter. sanitizeLookupQuery (research/lookup-guard.js) verwirft
  // Ziffernfolgen ab fuenf Stellen, E-Mails, die Zielrufnummer und woertliche
  // Transkript-Zitate und kappt auf 120 Zeichen - hat aber KEINEN Namensfilter. Ein
  // Personenname kann die Suchanfrage erreichen.
  //
  // WIRKSAMKEIT: dieser Wert ist nur ein Schnappschuss zum Aktivierungszeitpunkt.
  // resolveProfileFrom (store/defaults.js) liest PLAN_PROFILE NIE - bestehende Tenants
  // behalten ihr gespeichertes Profil, bis es neu geschrieben wird (billing/activation.js
  // oder scripts/backfill-plan-profiles.js). Ein Flip hier allein aendert fuer sie nichts.
  // GEDREHT 2026-08-19 (Owner-Auftrag Thema B, Auflage B4 - ersetzt die Entscheidung
  // vom 2026-08-11, s. Kommentar oben): die Datenschutzerklaerung nennt den
  // Suchdienst (Exa) noch NICHT. Bis sie es tut, bekommt KEIN Tarif-Profil das
  // Recherche-Recht - nur der Owner-Tenant traegt es (OWNER_PROFILE,
  // store/defaults.js). Wer den Kanal fuer zahlende Kunden oeffnet, dreht diesen
  // Wert zurueck UND zieht die Datenschutzerklaerung im selben Zug nach.
  allowLookup: false,
  allowBooking: false,
  maxCallsPerHour: null,
});

// planSlug -> vollstaendiges Tier-Profil. Eingefroren; unbekannter Slug fehlt hier
// (planProfileFor -> null = fail-closed). Vollstaendigkeit je Katalog-Slug ist
// test-gepinnt (test/plan-profile.test.js gegen CATALOG_SLUGS + PROFILE_FIELDS).
export const PLAN_PROFILE = Object.freeze({
  starter: PAID_PLAN_PROFILE,
  pro: PAID_PLAN_PROFILE,
});

// Tier-Profil nach Slug (Geschwister zu findPlan, gleiche ?? null-Konvention, G11).
// Unbekannter/leerer Slug -> null: der Aufrufer (A2-Aktivierung) SKIPt fail-closed
// statt setProfile(tenantId, undefined) zu schreiben (symmetrisch zu B2 "kein Plan -> blocken").
// Normalisiert zuerst: ein Bestands-Abo mit altem Slug behaelt sein bezahltes Rechteprofil,
// statt bei der naechsten Aktivierung fail-closed auf den Default (0 Calls/h) zu fallen.
export function planProfileFor(slug) {
  return PLAN_PROFILE[normalizePlanSlug(slug)] ?? null;
}
