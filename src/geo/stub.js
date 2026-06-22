// Geo-Stub (F1, Phase 6): netzfreier In-Memory-Adapter fuer Tests + den Default-Pfad
// (GEO_ENABLED aus). Reine Funktion, KEIN IO, KEIN Netz - deterministisch und damit
// F.I.R.S.T.-tauglich. Tests injizieren eine ip->country-Tabelle direkt (kein Flag-
// Toggle), die Registry nutzt den Null-Adapter (siehe registry.js).

/**
 * Baut einen Geo-Lookup ueber eine feste ip->country-Tabelle (ISO-3166-1-alpha-2).
 * Unbekannte IP -> null (Aufrufer faellt fail-safe auf DE zurueck). Die Tabelle ist
 * der einzige Zustand; die zurueckgegebene Funktion ist rein.
 * @param {Object<string,string>} [table] - ip -> ISO-2-Laendercode
 * @returns {import("./ports.js").GeoLookup}
 */
export function makeStubGeoLookup(table = {}) {
  return (ip) => {
    const country = table[ip];
    return country ? { country } : null;
  };
}

// Null-Adapter: loest NIE auf (-> immer DE-Fallback). DER Default, wenn GEO_ENABLED
// aus ist: DE byte-identisch zum Bestand, ohne mmdb-Asset, ohne Netz.
/** @type {import("./ports.js").GeoLookup} */
export const nullGeoLookup = () => null;
