import { MAX_NOTIFICATIONS } from "../../begriffe/speicher.js";
import { defaultSettings } from "../leerzustaende.js";
import { sanitizeProfile, resolveProfileFrom } from "../../begriffe/profil.js";
import { SUPPORTED_LANGUAGES, PERSONA_STYLE_IDS } from "../../i18n/locales.js";
import { hasInboundNotice } from "../../i18n/inbound-notice.ts";
import { newId, tenantsOf, type MandantRef } from "./grundlagen.ts";

type Einstellungen = Record<string, unknown>;
type Profil = Record<string, unknown>;

interface ZustandEinstellungen {
  settings: Partial<Record<string, Einstellungen>>;
}

interface ZustandProfile {
  profiles: Partial<Record<string, Profil>>;
}

interface ZustandZuordnung {
  tenants?: MandantRef[] | undefined;
  subIndex?: Record<string, string> | undefined;
}

export function settingsFor(state: ZustandEinstellungen, tenantId: string): Einstellungen {
  return (state.settings[tenantId] ??= defaultSettings());
}

type EnumErgebnis = { accepted: true; value: string | null } | { accepted: false; value: null };

function resolveOptionalEnumOverride(value: unknown, allowedValues: readonly string[]): EnumErgebnis {
  if (value === null || value === "") return { accepted: true, value: null };
  if (typeof value !== "string") return { accepted: false, value: null };
  const canonical = allowedValues.find((allowed) => allowed.toLowerCase() === value.toLowerCase());
  return canonical === undefined ? { accepted: false, value: null } : { accepted: true, value: canonical };
}

const OPTIONAL_ENUM_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  language: SUPPORTED_LANGUAGES,
  agentStyle: PERSONA_STYLE_IDS,
});

const FIELD_GUARDS: Readonly<Record<string, (text: unknown) => boolean>> = Object.freeze({ greeting: hasInboundNotice });

function neuerWert(key: string, value: unknown, allowed: Einstellungen): { value: unknown } | null {
  const enumValues = OPTIONAL_ENUM_FIELDS[key];
  if (enumValues) {
    const override = resolveOptionalEnumOverride(value, enumValues);
    return override.accepted ? { value: override.value } : null;
  }
  if (typeof value !== typeof allowed[key]) return null;
  const guard = FIELD_GUARDS[key];
  return guard && !guard(value) ? null : { value };
}

export function updateSettings(
  state: ZustandEinstellungen,
  tenantId: string,
  patch: Record<string, unknown> | null | undefined,
): { settings: Einstellungen; changed: string[] } {
  const allowed = defaultSettings();
  const changed: string[] = [];
  const target = settingsFor(state, tenantId);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in allowed)) continue;
    const neu = neuerWert(key, value, allowed);
    if (!neu) continue;
    if (target[key] !== neu.value) changed.push(key);
    target[key] = neu.value;
  }
  return { settings: target, changed };
}

export function resolveProfile(state: ZustandProfile, tenantId: string | null | undefined): unknown {
  return resolveProfileFrom(tenantId, tenantId ? state.profiles[tenantId] : undefined);
}

const subIndexOf = (state: ZustandZuordnung) => state.subIndex ?? {};

export function bindSubToTenant(
  state: ZustandZuordnung,
  sub: string | null | undefined,
  tenantId: string | null | undefined,
): void {
  if (!sub || !tenantId) return;
  (state.subIndex ??= {})[sub] = tenantId;
}

export function resolveTenant(state: ZustandZuordnung, idpSubject: string | null | undefined): string | null {
  if (!idpSubject) return null;
  const merged = subIndexOf(state)[idpSubject];
  if (merged) return merged;
  const tenant = tenantsOf(state).find((tenantEntry) => tenantEntry.idpSubject === idpSubject);
  return tenant ? tenant.id : null;
}

export function listProfiles(state: ZustandProfile): Partial<Record<string, Profil>> {
  return state.profiles;
}

export function setProfile(
  state: ZustandProfile,
  tenantId: string,
  patch: unknown,
): { profile: Profil | undefined; changed: string[] } {
  const clean = sanitizeProfile(patch);
  state.profiles[tenantId] = { ...(state.profiles[tenantId] ?? {}), ...clean };
  return { profile: state.profiles[tenantId], changed: Object.keys(clean) };
}

export function deleteProfile(state: ZustandProfile, tenantId: string): boolean {
  if (!(tenantId in state.profiles)) return false;
  Reflect.deleteProperty(state.profiles, tenantId);
  return true;
}

export function calendarFor(state: { calendar: Partial<Record<string, unknown[]>> }, tenantId: string): unknown[] {
  return (state.calendar[tenantId] ??= []);
}

export function benachrichtigungHinzufuegen(
  state: { notifications: unknown[] },
  { title, body, callId }: { title: unknown; body: unknown; callId: string },
): void {
  state.notifications.unshift({
    id: newId("nt"),
    title,
    body,
    callId: callId || null,
    at: new Date().toISOString(),
  });
  state.notifications.splice(MAX_NOTIFICATIONS);
}
