// F1 Geo-Location (Phase P7) - Land -> Telnyx-Suchparameter. DIE eine Quelle, die ein
// ISO-3166-1-alpha-2-Land (vom Number-Record) auf die telnyx-spezifischen Provisioning-
// Parameter abbildet: { countryCode, connectionId?, phoneNumberType? }. Liegt in der
// Telephonie-Schicht (NICHT in i18n/locales.js, das ist Sprache; NICHT in state-ops, das
// config-frei bleibt). Generisch: ein weiteres Land = ein weiterer Eintrag.
//
// KOSTEN/IDEMPOTENZ (Regel 1): diese Tabelle aendert den SUCHPARAMETER pro Job UND - seit
// P9 - optional den HOLD-Betrag pro Land (holdAmountCents, Integer Cents). Die drei
// Doppelkauf-Schloesser (Queue-Dedup, status===REQUESTED, Telnyx-Idempotency-Key) und die
// Hold-vor-Order-Invariante bleiben unberuehrt - sie liegen in der Queue/im Worker/in
// provisionNumber, nicht hier. P9 aendert NUR den Hold-WERT, nie die Dedup-/Order-Kette.
//
// HOLD PRO LAND (P9, R3 = Capture-Mismatch): heute ist der Hold ein fixer Wert fuer alle
// Laender (config.numberSetupFeeCents). Weicht der reale Telnyx-Laenderpreis davon ab,
// driftet der Hold vom Capture (R3). Diese Tabelle erlaubt pro Land einen eigenen
// holdAmountCents; fehlt der Eintrag (oder das Land ist gar nicht hier), greift der
// Default vom Aufrufer = config.numberSetupFeeCents = byte-identisch zum Bestand.
// KONSERVATIV: ein abweichender Wert wird erst eingetragen, wenn der Live-Preis bestaetigt
// ist (PROVISIONING_ENABLED bleibt false). Solange kein Wert gesetzt ist -> Default.
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
// holdAmountCents optional (P9, Integer Cents) - nur setzen, wenn der reale Laenderpreis
// vom config-Default abweicht UND live bestaetigt ist; sonst weglassen -> Default greift.
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

// Loest den Hold-Betrag (Integer Cents) fuer das Land (ISO-2, case-insensitiv) auf.
// Hat das Land einen Tabellen-Eintrag MIT holdAmountCents -> dieser Wert (Land-Tarif).
// Sonst (DE/leer/unbekannt/Land ohne eigenen Wert) -> defaultHoldCents vom Aufrufer
// (= config.numberSetupFeeCents) = byte-identisch zum Bestand. KEINE config-Kopplung im
// Modul (Default kommt als Arg, haelt das Modul testbar/config-arm). Money = Ganzzahl
// Cents: ein nicht-ganzzahliger Tabellen-Wert ist ein Programmierfehler -> fail-closed
// werfen (kein stiller Float-Hold, R3).
export function holdAmountForCountry(country, defaultHoldCents) {
  const key = String(country || "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  if (!entry || entry.holdAmountCents === undefined) return defaultHoldCents;
  if (!Number.isInteger(entry.holdAmountCents)) {
    throw new Error(`holdAmountCents fuer ${key} muss Integer-Cents sein`);
  }
  return entry.holdAmountCents;
}
