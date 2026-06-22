// Geo-Port (F1, Phase 6): Vertrag fuer die IP->Land-Aufloesung bei der Registrierung.
// DIP analog telephony/ports.js - reine JSDoc-Typdefs, keine Laufzeit-Logik. Der
// Lookup ist STRENG LOKAL (maxmind-mmdb oder Stub): die IP verlaesst den Prozess NIE
// (kein HTTP-Geo). Ergebnis dient NUR als Land-VORSCHLAG; die User-Wahl ist autoritativ
// (R4). Fehlende Aufloesung -> null -> Code-Fallback DE (defaults.js, R7).

/**
 * @callback GeoLookup
 * @param {string} ip - Client-IP (req.ip, proxy-aware). Verlaesst den Prozess nie.
 * @returns {{ country: string } | null}
 *   country = ISO-3166-1-alpha-2 (Grossbuchstaben). null = nicht aufloesbar
 *   (-> Aufrufer faellt auf provisioningCountry || DEFAULT_COUNTRY zurueck).
 */
export {};
