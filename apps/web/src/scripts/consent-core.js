export const CONSENT_VERSION = 1;
export const CONSENT_CATEGORIES = Object.freeze(["statistics", "marketing"]);

const UUID_BYTES = 16;
const HEX_DIGITS = "0123456789abcdef";
const NIBBLE_BITS = 4;
const NIBBLE_MASK = 0x0f;
const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;
const VERSION_MASK = 0x0f;
const VERSION_4 = 0x40;
const VARIANT_MASK = 0x3f;
const VARIANT_RFC4122 = 0x80;
const UUID_GROUPS = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/;

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

export function logPayload(consent) {
  return {
    id: consent.id,
    version: consent.version,
    statistics: consent.statistics,
    marketing: consent.marketing,
  };
}

export function revokedCategories(previous, next) {
  if (!previous) return [];
  return CONSENT_CATEGORIES.filter((category) => previous[category] && !next[category]);
}

export function needsReload({ previous, next, activated }) {
  return revokedCategories(previous, next).some((category) => activated.has(category));
}

export function shouldPrompt({ consent }) {
  return !consent;
}
