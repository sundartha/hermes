import { BOOTSTRAP_TENANT_ID } from "./begriffe-mandant.js";
import { normNum } from "./begriffe-rufnummern.js";

export const PROFILE_FIELDS = {
  allowedNumbers: "string[]",
  allowedCountryCodes: "string[]",
  unrestricted: "boolean",
  allowCalendar: "boolean",
  allowConsult: "boolean",
  allowLookup: "boolean",
  allowBooking: "boolean",
  maxCallsPerHour: "number?",
};

const REJECTED = Symbol("rejected");

function cleanStringList(key, value) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return REJECTED;
  }
  return key === "allowedNumbers"
    ? value.map(normNum).filter(Boolean)
    : value.map((code) => code.trim()).filter(Boolean);
}

function cleanValue(key, type, value) {
  if (type === "string[]") return cleanStringList(key, value);
  if (type === "number?") return value === null || typeof value === "number" ? value : REJECTED;
  return typeof value === type ? value : REJECTED;
}

export function sanitizeProfile(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const type = PROFILE_FIELDS[key];
    if (!type) continue;
    const cleaned = cleanValue(key, type, value);
    if (cleaned !== REJECTED) clean[key] = cleaned;
  }
  return clean;
}

const DEFAULT_PROFILE_MAX_CALLS_PER_HOUR = 0;

const OWNER_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: true,
  allowConsult: true,
  allowLookup: true,
  allowBooking: true,
  maxCallsPerHour: null,
};

const DEFAULT_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: false,
  allowConsult: false,
  allowLookup: false,
  allowBooking: false,
  maxCallsPerHour: DEFAULT_PROFILE_MAX_CALLS_PER_HOUR,
};

export function resolveProfileFrom(tenantId, storedProfile) {
  if (tenantId === BOOTSTRAP_TENANT_ID) return { ...OWNER_PROFILE };
  return storedProfile ? { ...DEFAULT_PROFILE, ...storedProfile } : { ...DEFAULT_PROFILE };
}
