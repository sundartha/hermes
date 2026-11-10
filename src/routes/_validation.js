import { KEY_FACTS_LIMITS, MANDATE_OUT_OF_SCOPE_VALUES } from "../store/defaults.js";
export { E164 } from "../store/defaults.js";
export { KEY_FACTS_LIMITS } from "../store/defaults.js";

export const IDENTITY_MAX_LEN = 254;
export const validIdentity = (e) =>
  typeof e === "string" && e.length > 0 && e.length <= IDENTITY_MAX_LEN && !/\s/.test(e);

export const TEXT_LIMITS = {
  objective: 500,
  briefing: 2000,
  constraints: 2000,
  title: 200,
  agentName: 80,
  "context.summary": 1000,
  "context.recipient_relationship": 200,
  "context.desired_outcome": 500,
  "mandate.decide_freely": 1000,
  "mandate.fallback_order": 500,
};

const OPEN_QUESTIONS_LIMITS = { maxItems: 10, maxLen: 300 };

export function invalidText(name, value) {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (value.length > TEXT_LIMITS[name])
    return `${name} ist zu lang (max. ${TEXT_LIMITS[name]} Zeichen)`;
  return null;
}

const C0_LETZTER = 0x1f;
const DEL = 0x7f;
const C1_LETZTER = 0x9f;

function steuerzeichen(codePoint) {
  return codePoint <= C0_LETZTER || (codePoint >= DEL && codePoint <= C1_LETZTER);
}

export function promptLineRejection(name, value) {
  if (typeof value !== "string") return null;
  if ([...value].length > TEXT_LIMITS[name]) return "too_long";
  if ([...value].some((zeichen) => steuerzeichen(zeichen.codePointAt(0)))) return "control_chars";
  return null;
}

export function invalidStringArray(name, value, { maxItems, maxLen }) {
  if (value == null) return null;
  if (!Array.isArray(value)) return `${name} muss eine Liste sein`;
  if (value.length > maxItems) return `${name} hat zu viele Eintraege (max. ${maxItems})`;
  for (const entry of value) {
    if (typeof entry !== "string") return `${name} darf nur Texte enthalten`;
    if (entry.length > maxLen) return `${name}: Eintrag zu lang (max. ${maxLen} Zeichen)`;
  }
  return null;
}

export function invalidEnum(name, value, allowed) {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (!allowed.includes(value)) return `${name} muss einer von ${allowed.join(", ")} sein`;
  return null;
}

function pickKnownFields(raw, fields) {
  const out = {};
  for (const field of fields) if (raw[field] != null) out[field] = raw[field];
  return Object.keys(out).length ? out : null;
}

function validateSubObject({ name, raw, fields, checkFields }) {
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

export function validateAssistantContext(raw) {
  return validateSubObject({
    name: "context",
    raw,
    fields: CONTEXT_FIELDS,
    checkFields: (v) =>
      invalidText("context.summary", v.summary) ||
      invalidText("context.recipient_relationship", v.recipient_relationship) ||
      invalidText("context.desired_outcome", v.desired_outcome) ||
      invalidStringArray("context.key_facts", v.key_facts, KEY_FACTS_LIMITS) ||
      invalidStringArray("context.open_questions", v.open_questions, OPEN_QUESTIONS_LIMITS),
  });
}

export function validateMandate(raw) {
  return validateSubObject({
    name: "mandate",
    raw,
    fields: MANDATE_FIELDS,
    checkFields: (v) =>
      invalidText("mandate.decide_freely", v.decide_freely) ||
      invalidText("mandate.fallback_order", v.fallback_order) ||
      invalidEnum("mandate.on_out_of_scope", v.on_out_of_scope, MANDATE_OUT_OF_SCOPE_VALUES),
  });
}
