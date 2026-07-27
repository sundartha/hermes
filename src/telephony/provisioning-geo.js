// F1 Geo-Location (Phase P7) - Land -> Telnyx-Suchparameter. DIE eine Quelle, die ein
// ISO-3166-1-alpha-2-Land (vom Number-Record) auf die telnyx-spezifischen Provisioning-
// Parameter abbildet: { countryCode, connectionId, type }. Liegt in der
// Telephonie-Schicht (NICHT in i18n/locales.js, das ist Sprache; NICHT in state-ops, das
// config-frei bleibt). Generisch: ein weiteres Land = ein weiterer Eintrag.
//
// NUMMERNART (P3, DID-09): jeder Suchaufruf traegt ab jetzt eine explizite Nummernart
// (DEFAULT_PHONE_NUMBER_TYPE, s.u.) - auch der config-Fallback. Der Telnyx-Default
// entscheidet damit NIE mehr, ob wir local, toll-free, national oder mobile kaufen.
// P3 aendert NUR den Suchparameter, keinen Geld-Betrag und kein Idempotenz-Schloss.
//
// KOSTEN/IDEMPOTENZ (Regel 1): diese Tabelle aendert den SUCHPARAMETER pro Job UND - seit
// P9 - optional den HOLD-Betrag pro Land (holdAmountCents, Integer Cents). Die drei
// Doppelkauf-Schloesser (Queue-Dedup, status===REQUESTED, Telnyx-Idempotency-Key) und die
// Hold-vor-Order-Invariante bleiben unberuehrt - sie liegen in der Queue/im Worker/in
// provisionNumber, nicht hier. P9 aendert NUR den Hold-WERT, nie die Dedup-/Order-Kette.
//
// HOLD PRO LAND (P9, R3 = Capture-Mismatch): heute ist der Hold ein fixer Wert fuer alle
// Laender (config.billing.numberSetupFeeCents). Weicht der reale Telnyx-Laenderpreis davon ab,
// driftet der Hold vom Capture (R3). Diese Tabelle erlaubt pro Land einen eigenen
// holdAmountCents; fehlt der Eintrag (oder das Land ist gar nicht hier), greift der
// Default vom Aufrufer = config.billing.numberSetupFeeCents = byte-identisch zum Bestand.
// KONSERVATIV: ein abweichender Wert wird erst eingetragen, wenn der Live-Preis bestaetigt
// ist (PROVISIONING_ENABLED bleibt false). Solange kein Wert gesetzt ist -> Default.
//
// DE byte-identisch (R-Dichtheit): fuer DE UND fuer jedes unbekannte/leere Land liefert
// die Aufloesung den globalen config-Fallback (provisioningCountry/telnyxConnectionId) -
// also exakt das frueher global verwendete Verhalten. So faerbt kein neues Land den
// DE-Bestand ab und der Dry-Run (PROVISIONING_ENABLED=false) bleibt byte-identisch.
import { config } from "../config.js";

// Telnyx-Nummernart (filter[phone_number_type]) fuer JEDEN Kauf. "local" = geografische
// Ortsnummer - das ist das Produkt, das Hermes verkauft, und es ist EINE Entscheidung,
// nicht eine pro Land (deshalb hier eine Konstante statt eines Feldes je Eintrag).
// Ohne den Filter entscheidet der Telnyx-Default zwischen local/toll-free/national/mobile
// und faerbt damit Zustellbarkeit UND Preis jeder gekauften Nummer (DID-09). Fehlt "local"
// im Inventar eines Landes, liefert die Suche 0 Treffer -> kontrollierter Fehlschlag
// (failNumber + Hold-Freigabe, R5), NIE ein stiller Kauf der falschen Nummernart.
const DEFAULT_PHONE_NUMBER_TYPE = "local";

// Kauf-Land (ISO-2) -> Abweichungen von den globalen Defaults. Der SCHLUESSEL ist das
// Land, in dem gesucht wird: ein Land mit Eintrag kauft IMMER im eigenen Land und nie
// still im Plattform-Default (DID-05). Der Wert traegt NUR Abweichungen -
//   connectionId    : eigene Telnyx-App statt config.telephony.telnyxConnectionId
//   phoneNumberType : andere Nummernart als DEFAULT_PHONE_NUMBER_TYPE
//   holdAmountCents : eigener Setup-Tarif (P9, Integer Cents) statt des config-Defaults
// - und ist deshalb heute fuer jedes Land leer. Ein weiteres Land = ein weiterer Schluessel.
// DE bewusst NICHT hier: der config-Fallback (provisioningCountry) IST das Plattform-Land;
// ein DE-Eintrag waere eine zweite Quelle fuer denselben Wert (G5) und wuerde den
// byte-identischen Fallback-Pfad an ein Literal koppeln.
const COUNTRY_SEARCH_PARAMS = Object.freeze({
  AT: {},
  AU: {},
  CA: {},
  CH: {},
  ES: {},
  FR: {},
  GB: {},
  IE: {},
  IT: {},
  US: {},
});

// Loest das Land (ISO-2, case-insensitiv) auf die telnyx-Suchparameter auf.
// Land MIT Tabellen-Eintrag -> es wird in genau diesem Land gesucht (DID-05).
// DE/leer/unbekannt -> globaler Fallback (provisioningCountry/telnyxConnectionId),
// byte-identisch zum Bestand (Regel 6: unbekannt -> sicherer Default).
// connectionId und Nummernart kommen vom globalen Default, bis ein Land davon abweicht.
export function searchParamsForCountry(country) {
  const key = String(country || "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  return {
    countryCode: entry ? key : config.provisioning.provisioningCountry,
    connectionId: entry?.connectionId || config.telephony.telnyxConnectionId,
    // IMMER gesetzt (DID-09): der Provider-Default darf die Nummernart nie entscheiden.
    type: entry?.phoneNumberType || DEFAULT_PHONE_NUMBER_TYPE,
  };
}

// Loest den Hold-Betrag (Integer Cents) fuer das Land (ISO-2, case-insensitiv) auf.
// Hat das Land einen Tabellen-Eintrag MIT holdAmountCents -> dieser Wert (Land-Tarif).
// Sonst (DE/leer/unbekannt/Land ohne eigenen Wert) -> defaultHoldCents vom Aufrufer
// (= config.billing.numberSetupFeeCents) = byte-identisch zum Bestand. KEINE config-Kopplung im
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
