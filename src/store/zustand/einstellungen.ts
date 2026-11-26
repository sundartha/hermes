import { MAX_NOTIFICATIONS } from "../../begriffe/speicher.js";
import { defaultSettings } from "../leerzustaende.js";
import { sanitizeProfile, resolveProfileFrom } from "../../begriffe/profil.js";
import { PERSONA_STYLE_IDS } from "../../i18n/locales.ts";
import { sprachcodeOf } from "../../i18n/sprachcode.ts";
import { hasInboundNotice } from "../../i18n/inbound-notice.ts";
import { newId, tenantsOf } from "./grundlagen.js";
import type { MandantRef } from "./grundzugriffe.ts";

interface Einstellungen {
  language?: string | null;
  [feld: string]: unknown;
}
type Profil = Record<string, unknown>;
type Termin = Record<string, unknown>;
type Pruefung = (wert: unknown) => boolean;

export interface EinstellungenZustand {
  settings: Record<string, Einstellungen>;
  profiles: Record<string, Profil>;
  calendar: Record<string, Termin[]>;
  subIndex?: Record<string, string>;
  tenants?: MandantRef[];
  notifications: Record<string, unknown>[];
}

interface Neuer {
  value: unknown;
}

export function settingsFor(state: EinstellungenZustand, tenantId: string): Einstellungen {
  return (state.settings[tenantId] ??= defaultSettings());
}

function resolveOptionalEnumOverride(
  value: unknown,
  allowedValues: readonly string[],
): { accepted: boolean; value: string | null } {
  if (value === null || value === "") return { accepted: true, value: null };
  if (typeof value !== "string") return { accepted: false, value: null };
  const canonical = allowedValues.find((allowed) => allowed.toLowerCase() === value.toLowerCase());
  return canonical === undefined ? { accepted: false, value: null } : { accepted: true, value: canonical };
}

function neueSprache(value: unknown): Neuer | null {
  if (value === null || value === "") return { value: null };
  const code = sprachcodeOf(value);
  return code.ok ? { value: code.wert } : null;
}

const OPTIONAL_ENUM_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  agentStyle: PERSONA_STYLE_IDS,
});

const FIELD_GUARDS: Readonly<Record<string, Pruefung>> = Object.freeze({ greeting: hasInboundNotice });

function neuerWert(key: string, value: unknown, allowed: Einstellungen): Neuer | null {
  if (key === "language") return neueSprache(value);
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
  state: EinstellungenZustand,
  tenantId: string,
  patch?: Einstellungen | null,
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

export function resolveProfile(state: EinstellungenZustand, tenantId: string | null): unknown {
  return resolveProfileFrom(tenantId, tenantId ? state.profiles[tenantId] : undefined);
}

const subIndexOf = (state: EinstellungenZustand) => state.subIndex ?? {};

export function bindSubToTenant(state: EinstellungenZustand, sub: string | null, tenantId: string | null): void {
  if (!sub || !tenantId) return;
  (state.subIndex ??= {})[sub] = tenantId;
}

export function resolveTenant(state: EinstellungenZustand, idpSubject: string | null): string | null {
  if (!idpSubject) return null;
  const merged = subIndexOf(state)[idpSubject];
  if (merged) return merged;
  const tenant = tenantsOf(state).find((tenantEntry) => tenantEntry.idpSubject === idpSubject);
  return tenant ? tenant.id : null;
}

export function listProfiles(state: EinstellungenZustand): Record<string, Profil> {
  return state.profiles;
}

export function setProfile(state: EinstellungenZustand, tenantId: string, patch: Profil): { profile: Profil | undefined; changed: string[] } {
  const clean = sanitizeProfile(patch);
  state.profiles[tenantId] = { ...(state.profiles[tenantId] ?? {}), ...clean };
  return { profile: state.profiles[tenantId], changed: Object.keys(clean) };
}

export function deleteProfile(state: EinstellungenZustand, tenantId: string): boolean {
  if (!(tenantId in state.profiles)) return false;
  Reflect.deleteProperty(state.profiles, tenantId);
  return true;
}

export function calendarFor(state: EinstellungenZustand, tenantId: string): Termin[] {
  return (state.calendar[tenantId] ??= []);
}

export function benachrichtigungHinzufuegen(
  state: EinstellungenZustand,
  { title, body, callId }: { title: string; body: string; callId: string },
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
