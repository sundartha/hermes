// Geo-maxmind-Adapter (F1, Phase 6): lokaler IP->Land-Lookup ueber eine maxmind-
// GeoLite2-Country-mmdb-Datei. STRENG LOKAL - die IP verlaesst den Prozess nie.
//
// DEP-REGEL (hart): KEINE neue npm-Dependency. Ein echter mmdb-Binaer-Reader braucht
// einen Parser (z.B. das 'maxmind'-Paket) ODER einen eigenhaendigen mmdb-Parser; beides
// ist hier bewusst NICHT eingebaut. Stattdessen ist die Verdrahtung fertig, aber der
// Reader liefert FAIL-SAFE null, solange (a) GEO_ENABLED aus ist, (b) kein Asset-Pfad
// (geoDbPath) gesetzt ist oder (c) der Reader fehlt. null -> Aufrufer faellt auf DE
// zurueck (defaults.js, R7) - NIE Crash, NIE Dep-Pflicht.
//
// FOLGE-TICKET / SMOKE-GATE: Echten mmdb-Reader (ggf. mit Owner-genehmigtem Dep) +
// GeoLite2-Asset einbauen, dann hinter GEO_ENABLED=true live schalten. Bis dahin deckt
// der Stub-Adapter die Tests (Onboard-Wiring voll testbar), Produktiv-Flag bleibt aus.

/**
 * Baut den maxmind-Lookup. Aktuell ohne Reader-Dep -> liefert immer null (fail-safe).
 * Die Signatur (dbPath) steht bereits, damit die spaetere Reader-Verdrahtung nur den
 * Funktionskoerper austauscht, nicht die Aufrufer.
 * @param {string} [dbPath] - Pfad zur GeoLite2-Country-mmdb (config.provisioning.geoDbPath)
 * @returns {import("./ports.js").GeoLookup}
 */
export function makeMaxmindGeoLookup(dbPath = "") {
  // Kein Reader/Asset verdrahtet -> fail-safe null. Bewusst kein throw: ein fehlendes
  // Asset darf das Onboarding NIE blockieren (DE-Fallback ist immer korrekt).
  void dbPath;
  return () => null;
}
