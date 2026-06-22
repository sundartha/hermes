// F1 Geo-Location (Phase P7) - Land -> Telnyx-Suchparameter. DIE eine Quelle, die ein
// ISO-3166-1-alpha-2-Land (vom Number-Record) auf die telnyx-spezifischen Provisioning-
// Parameter abbildet: { countryCode, connectionId?, phoneNumberType? }. Liegt in der
// Telephonie-Schicht (NICHT in i18n/locales.js, das ist Sprache; NICHT in state-ops, das
// config-frei bleibt). Generisch: ein weiteres Land = ein weiterer Eintrag.
//
// KOSTEN/IDEMPOTENZ (Regel 1): diese Tabelle aendert NUR den SUCHPARAMETER pro Job. Die
// drei Doppelkauf-Schloesser (Queue-Dedup, status===REQUESTED, Telnyx-Idempotency-Key)
// und die Hold-vor-Order-Invariante bleiben unberuehrt - sie liegen in der Queue/im
// Worker/in provisionNumber, nicht hier.
//
// DE byte-identisch (R-Dichtheit): fuer DE UND fuer jedes unbekannte/leere Land liefert
// die Aufloesung den globalen config-Fallback (provisioningCountry/telnyxConnectionId) -
// also exakt das frueher global verwendete Verhalten. So faerbt kein neues Land den
// DE-Bestand ab und der Dry-Run (PROVISIONING_ENABLED=false) bleibt byte-identisch.
import { config } from "../config.js";

// Land (ISO-2) -> telnyx-spezifische Such-/Configure-Parameter. NUR Laender, die von DE
// abweichen, brauchen einen Eintrag (telnyxCountryCode != Land oder eigene connectionId/
// Typ). DE bewusst NICHT hier: es faellt auf den globalen config-Fallback (siehe unten).
// phoneNumberType optional (Telnyx filter[phone_number_type]) - nur setzen, wenn das Land
// es braucht; sonst weglassen (Adapter laesst den Filter dann weg).
const COUNTRY_SEARCH_PARAMS = Object.freeze({
  FR: { telnyxCountryCode: "FR" },
  GB: { telnyxCountryCode: "GB" },
});

// Loest das Land (ISO-2, case-insensitiv) auf die telnyx-Suchparameter auf.
// Bekanntes Land -> Tabellen-Eintrag (telnyxCountryCode + optional connectionId/Typ),
// connectionId faellt mangels Tabellen-Wert auf den globalen config-Wert (eine Telnyx-
// App fuer alle Laender, bis ein Land eine eigene braucht). DE/leer/unbekannt -> globaler
// Fallback (provisioningCountry/telnyxConnectionId) = byte-identisch zum Bestand.
export function searchParamsForCountry(country) {
  const key = String(country || "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  if (!entry) {
    // DE/unbekannt/leer: globales Verhalten (Regel 6: unbekannt -> sicherer Default).
    return { countryCode: config.provisioningCountry, connectionId: config.telnyxConnectionId };
  }
  return {
    countryCode: entry.telnyxCountryCode,
    connectionId: entry.connectionId || config.telnyxConnectionId,
    ...(entry.phoneNumberType ? { type: entry.phoneNumberType } : {}),
  };
}
