// Geo-Registry (F1, Phase 6): waehlt den aktiven Geo-Lookup-Adapter, fail-closed
// analog telephony/registry.js. GEO_ENABLED aus (Default) -> nullGeoLookup (loest nie
// auf -> DE-Fallback, netzfrei, kein Asset noetig, DE byte-identisch). GEO_ENABLED an
// -> maxmind-Adapter (heute noch fail-safe null bis Reader/Asset stehen, siehe
// maxmind.js). Unit-Tests injizieren ihren Stub-Adapter DIREKT in den Onboard-Pfad
// (kein Flag-Toggle), diese Registry deckt nur den Produktions-Pfad ueber das Flag.
import { config } from "../config.js";
import { nullGeoLookup } from "./stub.js";
import { makeMaxmindGeoLookup } from "./maxmind.js";

/**
 * Liefert den konfigurierten Geo-Lookup. config-getrieben (geoEnabled/geoDbPath).
 * @returns {import("./ports.js").GeoLookup}
 */
export function geoLookupAdapter() {
  if (!config.geoEnabled) return nullGeoLookup;
  return makeMaxmindGeoLookup(config.geoDbPath);
}
