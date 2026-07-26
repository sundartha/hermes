// Onboarding-Land-Aufloesung (F1, Phase 6): reine, config-freie Helfer fuer die
// Land-Praezedenz bei der Registrierung. Getrennt von server.js (das beim Import
// app.listen()t) -> unit-testbar ohne Server-Boot. Die language-Ableitung lebt in
// i18n/locales.js (languageForCountry); hier NUR die Land-Wahl.
import { DEFAULT_COUNTRY, DEFAULT_TIMEZONE } from "../store/defaults.js";
import { languageForCountry } from "../i18n/locales.js";

// Normalisiert einen Land-Kandidaten: NUR ein striktes ISO-3166-1-alpha-2 (zwei
// Buchstaben) wird akzeptiert (Grossbuchstaben), sonst null (-> fail-safe auf den
// naechsten Praezedenz-Schritt). KEINE Allowlist-Lockerung - reine Eingabe-Validierung.
export function normCountry(raw) {
  const cc = String(raw || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

// Land-Praezedenz beim Onboarding: User-Wahl (autoritativ, R4) > IP-Geo-VORSCHLAG >
// config-Fallback > DEFAULT_COUNTRY. Eine gespoofte IP aendert nichts Autoritatives -
// mit User-Wahl wird sie ueberstimmt, ohne ist sie nur ein Vorschlag. Der Fallback
// (config.provisioning.provisioningCountry) wird vom Aufrufer hereingereicht (config-frei).
export function resolveOnboardCountry({ userCountry, proposedCountry, fallbackCountry } = {}) {
  return (
    normCountry(userCountry) || normCountry(proposedCountry) || fallbackCountry || DEFAULT_COUNTRY
  );
}

// Kauf-Land-Praezedenz (Runde 1, PLAN-VOUCHER-SETUP-FEE-GAP.md Phase A): das Land, in dem
// eine Nummer TATSAECHLICH gekauft wird, kann vom Herkunftsland (homeCountry, s.o.)
// abweichen - config.provisioning.forceNumberCountry (z.B. "US") ueberschreibt NUR den Kauf, nie
// Sprache/Analytics (die bleiben am Herkunftsland). Leer/undefined -> Kauf-Land =
// Herkunftsland (byte-identisch). EIN Ort fuer diese Kombination (G5): requestNumberFor-
// PaidTenant (provision-trigger.js, der tatsaechliche Kauf) UND numberSetupFeeCentsFor
// (self-service-routes.js, die Anzeige-Formel VOR dem Kauf) rufen dieselbe Funktion - keine
// dritte, abweichende Inline-Kopie der "welches Land kauft?"-Logik.
export function resolveNumberCountry(homeCountry, forceNumberCountry) {
  return forceNumberCountry || homeCountry;
}

// P8/FMT-28: Land -> IANA-Zeitzone. Schwestertabelle zu LANGUAGE_FOR_COUNTRY
// (i18n/locales.js): dieselbe Form, derselbe Vertrag (unbekannt -> Default, NIE Crash).
// Bewusst EIN Eintrag je Land: Mehrzonenlaender (US/CA/FR-DOM) bekommen die Zone ihrer
// Hauptzeit - eine Anzeige-Naeherung, kein Gate (LAW-07 ist abgelehnt).
export const TIMEZONE_FOR_COUNTRY = Object.freeze({
  DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich",
  FR: "Europe/Paris", GB: "Europe/London", IE: "Europe/Dublin",
  US: "America/New_York", CA: "America/Toronto",
});

// Land (ISO-2, case-insensitiv) -> Zeitzone. Fehlend/leer/unbekannt -> DEFAULT_TIMEZONE.
export function timezoneForCountry(country) {
  return TIMEZONE_FOR_COUNTRY[String(country || "").toUpperCase()] || DEFAULT_TIMEZONE;
}

// P8 (LANG-02/FMT-28): die vollstaendige Geo-Identitaet eines Tenants aus seinem Land.
// DIE EINE Quelle fuer BEIDE Eintrittspfade - POST /api/onboard und der Web-Login
// schreiben genau dieses Objekt ueber setTenantGeo (G5, kein Drift zwischen den Pfaden).
// Reine Funktion, config-frei; der Aufrufer hat das Land vorher aufgeloest
// (resolveOnboardCountry).
export function tenantGeoForCountry(country) {
  return {
    country,
    defaultLanguage: languageForCountry(country),
    timezone: timezoneForCountry(country),
  };
}
