import { KEY_FACTS_LIMITS, MANDATE_OUT_OF_SCOPE_VALUES } from "../begriffe/anrufe.ts";
import { TEXT_LIMITS, type TextName } from "../begriffe/anruf-pruefung.ts";

interface Grenzen {
  maxItems: number;
  maxLen: number;
}
type Felder = Record<string, unknown>;
type Teilobjekt = { value: Felder | null } | { error: string };

const OPEN_QUESTIONS_LIMITS = { maxItems: 10, maxLen: 300 };

export function invalidText(name: TextName, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (value.length > TEXT_LIMITS[name])
    return `${name} ist zu lang (max. ${String(TEXT_LIMITS[name])} Zeichen)`;
  return null;
}

export function invalidStringArray(name: string, value: unknown, { maxItems, maxLen }: Grenzen): string | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return `${name} muss eine Liste sein`;
  if (value.length > maxItems) return `${name} hat zu viele Eintraege (max. ${String(maxItems)})`;
  for (const entry of value) {
    if (typeof entry !== "string") return `${name} darf nur Texte enthalten`;
    if (entry.length > maxLen) return `${name}: Eintrag zu lang (max. ${String(maxLen)} Zeichen)`;
  }
  return null;
}

export function invalidEnum(name: string, value: unknown, allowed: readonly string[]): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (!allowed.includes(value)) return `${name} muss einer von ${allowed.join(", ")} sein`;
  return null;
}

function pickKnownFields(raw: object, fields: readonly string[]): Felder | null {
  const out: Felder = {};
  for (const field of fields) if (Reflect.get(raw, field) != null) out[field] = Reflect.get(raw, field);
  return Object.keys(out).length ? out : null;
}

function validateSubObject({
  name,
  raw,
  fields,
  checkFields,
}: {
  name: string;
  raw: unknown;
  fields: readonly string[];
  checkFields: (felder: Felder) => string | null;
}): Teilobjekt {
  if (raw == null) return { value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: `${name} muss ein Objekt sein` };
  const value = pickKnownFields(raw, fields);
  if (value == null) return { value: null };
  const error = checkFields(value);
  return error ? { error } : { value };
}

const CONTEXT_FIELDS = [
  "summary",
  "recipient_relationship",
  "desired_outcome",
  "key_facts",
  "open_questions",
];
const MANDATE_FIELDS = ["decide_freely", "fallback_order", "on_out_of_scope"];

export function validateAssistantContext(raw: unknown): Teilobjekt {
  return validateSubObject({
    name: "context",
    raw,
    fields: CONTEXT_FIELDS,
    checkFields: (felder) =>
      invalidText("context.summary", felder["summary"]) ??
      invalidText("context.recipient_relationship", felder["recipient_relationship"]) ??
      invalidText("context.desired_outcome", felder["desired_outcome"]) ??
      invalidStringArray("context.key_facts", felder["key_facts"], KEY_FACTS_LIMITS) ??
      invalidStringArray("context.open_questions", felder["open_questions"], OPEN_QUESTIONS_LIMITS),
  });
}

export function validateMandate(raw: unknown): Teilobjekt {
  return validateSubObject({
    name: "mandate",
    raw,
    fields: MANDATE_FIELDS,
    checkFields: (felder) =>
      invalidText("mandate.decide_freely", felder["decide_freely"]) ??
      invalidText("mandate.fallback_order", felder["fallback_order"]) ??
      invalidEnum("mandate.on_out_of_scope", felder["on_out_of_scope"], MANDATE_OUT_OF_SCOPE_VALUES),
  });
}
