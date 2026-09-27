/* =============================================================================
 * consent-core.js — die reinen Entscheidungen hinter consent.js (kein DOM, kein
 * Speicher, kein Netz). Eigenes Modul, damit sie ohne Browser testbar sind
 * (test/cookie-consent-client.test.js im Wurzelprojekt).
 * ========================================================================== */

export const CONSENT_VERSION = 1;
export const CONSENT_CATEGORIES = Object.freeze(["statistics", "marketing"]);

const UUID_BYTES = 16;
// Hex per Nachschlagen statt Number#toString: haelt apps/web frei von weiteren
// toString/toLocale-Aufrufstellen (test/dashboard-i18n-surface.test.js, WEB-18).
const HEX_DIGITS = "0123456789abcdef";
const NIBBLE_BITS = 4;
const NIBBLE_MASK = 0x0f;
const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;
const VERSION_MASK = 0x0f;
const VERSION_4 = 0x40;
const VARIANT_MASK = 0x3f;
const VARIANT_RFC4122 = 0x80;
// 32 Hex-Zeichen in die UUID-Gruppen 8-4-4-4-12 teilen.
const UUID_GROUPS = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/;

// Zufalls-UUID (v4) als Kennung EINES Browsers im Einwilligungs-Protokoll. Bevorzugt
// crypto.randomUUID; aeltere Browser bekommen dieselbe Form aus getRandomValues.
export function newConsentId(cryptoApi) {
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(UUID_BYTES));
  bytes[VERSION_BYTE] = (bytes[VERSION_BYTE] & VERSION_MASK) | VERSION_4;
  bytes[VARIANT_BYTE] = (bytes[VARIANT_BYTE] & VARIANT_MASK) | VARIANT_RFC4122;
  const hex = [...bytes]
    .map((byte) => HEX_DIGITS[byte >> NIBBLE_BITS] + HEX_DIGITS[byte & NIBBLE_MASK])
    .join("");
  return hex.replace(UUID_GROUPS, "$1-$2-$3-$4-$5");
}

// Der neue Stand einer Entscheidung. Die Kennung bleibt ueber Aenderungen und Widerruf
// hinweg dieselbe - nur so ergibt das Protokoll je Browser eine lueckenlose Folge.
export function buildConsent({ choice, previous, id, now }) {
  return {
    version: CONSENT_VERSION,
    id: (previous && previous.id) || id,
    ts: now.toISOString(),
    necessary: true,
    statistics: Boolean(choice.statistics),
    marketing: Boolean(choice.marketing),
  };
}

// Was das Protokoll erhaelt: genau vier Felder, nichts vom Geraet.
export function logPayload(consent) {
  return {
    id: consent.id,
    version: consent.version,
    statistics: consent.statistics,
    marketing: consent.marketing,
  };
}

// Kategorien, die vorher erlaubt waren und jetzt nicht mehr (= Widerruf).
export function revokedCategories(previous, next) {
  if (!previous) return [];
  return CONSENT_CATEGORIES.filter((category) => previous[category] && !next[category]);
}

// Ein einmal geladenes Skript laesst sich nicht "entladen". Wurde eine Kategorie
// widerrufen, deren Skript auf dieser Seite bereits laeuft, hilft nur ein Neuladen -
// danach bleibt der Platzhalter gesperrt. activated = Kategorien mit laufendem Skript.
export function needsReload({ previous, next, activated }) {
  return revokedCategories(previous, next).some((category) => activated.has(category));
}

// Den Banner ungefragt zeigen, solange noch keine Entscheidung vorliegt - beim ersten
// Besuch also immer, auch wenn heute nur Notwendiges laeuft (Owner-Entscheidung
// 2026-09-27: "wenn der User auf die Seite kommt, muss direkt die Cookie-Abfrage
// kommen"). Nach der Wahl oeffnet ihn nur noch "Cookie-Einstellungen".
export function shouldPrompt({ consent }) {
  return !consent;
}
