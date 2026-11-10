import { defaultSettings, sanitizeProfile, resolveProfileFrom } from "../defaults.js";
import { SUPPORTED_LANGUAGES, PERSONA_STYLE_IDS } from "../../i18n/locales.js";
import { hasInboundNotice } from "../../i18n/inbound-notice.js";
import { tenantsOf } from "./grundlagen.js";

export function settingsFor(state, tenantId) {
  return (state.settings[tenantId] ||= defaultSettings());
}

function resolveOptionalEnumOverride(value, allowedValues) {
  if (value === null || value === "") return { accepted: true, value: null };
  if (typeof value !== "string") return { accepted: false, value: null };
  const canonical = allowedValues.find((allowed) => allowed.toLowerCase() === value.toLowerCase());
  return canonical === undefined ? { accepted: false, value: null } : { accepted: true, value: canonical };
}

const OPTIONAL_ENUM_FIELDS = Object.freeze({
  language: SUPPORTED_LANGUAGES,
  agentStyle: PERSONA_STYLE_IDS,
});

const FIELD_GUARDS = Object.freeze({ greeting: hasInboundNotice });

function neuerWert(key, value, allowed) {
  const enumValues = OPTIONAL_ENUM_FIELDS[key];
  if (enumValues) {
    const override = resolveOptionalEnumOverride(value, enumValues);
    return override.accepted ? { value: override.value } : null;
  }
  if (typeof value !== typeof allowed[key]) return null;
  const guard = FIELD_GUARDS[key];
  return guard && !guard(value) ? null : { value };
}

export function updateSettings(state, tenantId, patch) {
  const allowed = defaultSettings();
  const changed = [];
  const target = settingsFor(state, tenantId);
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in allowed)) continue;
    const neu = neuerWert(key, value, allowed);
    if (!neu) continue;
    if (target[key] !== neu.value) changed.push(key);
    target[key] = neu.value;
  }
  return { settings: target, changed };
}

export function resolveProfile(state, tenantId) {
  return resolveProfileFrom(tenantId, tenantId ? state.profiles[tenantId] : undefined);
}

const subIndexOf = (state) => state.subIndex || {};

export function bindSubToTenant(state, sub, tenantId) {
  if (!sub || !tenantId) return;
  (state.subIndex ||= {})[sub] = tenantId;
}

export function resolveTenant(state, idpSubject) {
  if (!idpSubject) return null;
  const merged = subIndexOf(state)[idpSubject];
  if (merged) return merged;
  const tenant = tenantsOf(state).find((tenantEntry) => tenantEntry.idpSubject === idpSubject);
  return tenant ? tenant.id : null;
}

export function listProfiles(state) {
  return state.profiles;
}

export function setProfile(state, tenantId, patch) {
  const clean = sanitizeProfile(patch);
  state.profiles[tenantId] = { ...(state.profiles[tenantId] || {}), ...clean };
  return { profile: state.profiles[tenantId], changed: Object.keys(clean) };
}

export function deleteProfile(state, tenantId) {
  if (!(tenantId in state.profiles)) return false;
  delete state.profiles[tenantId];
  return true;
}

export function calendarFor(state, tenantId) {
  return (state.calendar[tenantId] ||= []);
}
