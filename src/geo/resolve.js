// Onboarding-Land-Aufloesung (F1, Phase 6): reine, config-freie Helfer fuer die
// Land-Praezedenz bei der Registrierung. Getrennt von server.js (das beim Import
// app.listen()t) -> unit-testbar ohne Server-Boot. Die language-Ableitung lebt in
// i18n/locales.js (languageForCountry); hier NUR die Land-Wahl.
import { DEFAULT_COUNTRY } from "../store/defaults.js";

// Normalisiert einen Land-Kandidaten: NUR ein striktes ISO-3166-1-alpha-2 (zwei
// Buchstaben) wird akzeptiert (Grossbuchstaben), sonst null (-> fail-safe auf den
// naechsten Praezedenz-Schritt). KEINE Allowlist-Lockerung - reine Eingabe-Validierung.
export function normCountry(raw) {
  const cc = String(raw || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

// Land-Praezedenz beim Onboarding: User-Wahl (autoritativ, R4) > IP-Geo-VORSCHLAG >
// config-Fallback > DEFAULT_COUNTRY. Eine gespoofte IP aendert nichts Autoritatives -
// mit User-Wahl wird sie ueberstimmt, ohne ist sie nur ein Vorschlag. Der Fallback
// (config.provisioningCountry) wird vom Aufrufer hereingereicht (config-frei).
export function resolveOnboardCountry({ userCountry, proposedCountry, fallbackCountry } = {}) {
  return normCountry(userCountry) || normCountry(proposedCountry) || fallbackCountry || DEFAULT_COUNTRY;
}
