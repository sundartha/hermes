// Eingabe-Validierung fuer API-Routen (T4 Phase 2 — enabling refactor).
//
// Reine Konstanten/Funktionen ohne Netz-/config-Deps, aus src/server.js an ihren
// T4-Zielort verschoben (siehe docs/strategy/t4-server-decomposition.md §3.2 Klasse C).
// invalidText/TEXT_LIMITS leben lokal; E164 wird seit F2 aus store/defaults.js
// re-exportiert (reines Konstanten-Modul, keine Store-State-/Netz-Last zur Laufzeit).
// Von mehreren Konsumenten geteilt (HTTP-Kante der /api/calls-Gruppe, die Outbound-Gates
// und der Onboard-Pfad) -> eigenes Mini-Modul, von allen importiert (G5: eine Quelle,
// kein Copy-Paste). Verhaltens-erhaltend gegenueber der urspruenglichen Definition.

// E.164-Format: '+' gefolgt von 7-15 Ziffern, erste Ziffer != 0. Kanonisch in
// store/defaults.js neben normNum (EINE Quelle, G5 - F2 brauchte denselben Regex im
// private-number-Setter; statt einer zweiten Kopie re-exportieren wir hier). Die
// bestehenden Konsumenten (server.js /api/calls) importieren E164 unveraendert von hier.
import { KEY_FACTS_LIMITS, MANDATE_OUT_OF_SCOPE_VALUES } from "../store/defaults.js";
export { E164 } from "../store/defaults.js";
// P3-Deckel des key_facts-Arrays: liegt seit AL-P13 in store/defaults.js (EINE Quelle
// fuer HTTP-Kante und Consult-Merge, Muster E164) und wird hier fuer die Konsumenten
// dieser Datei re-exportiert. Werte unveraendert -> Verhalten byte-identisch.
export { KEY_FACTS_LIMITS } from "../store/defaults.js";

// Gestalt-Pruefung eines Identitaets-/Routing-Schluessels: nicht-leerer String ohne
// Whitespace, hoechstens IDENTITY_MAX_LEN Zeichen. BEWUSST KEINE strikte Email-Form -
// derselbe Validator deckt die tenantId (z.B. "t_user_01...") und den IdP-sub ab, daher
// der generische Name. Aus routes/api-profiles.js hierher gezogen, als dessen HTTP-Routen
// mit AUTH-P4 entfielen; Werte und Verhalten byte-identisch.
export const IDENTITY_MAX_LEN = 254; // RFC 5321 (Email-Obergrenze, reicht auch fuer sub/tenantId)
export const validIdentity = (e) =>
  typeof e === "string" && e.length > 0 && e.length <= IDENTITY_MAX_LEN && !/\s/.test(e);

export const TEXT_LIMITS = {
  objective: 500,
  briefing: 2000,
  constraints: 2000,
  title: 200,
  // P3 (PLAN-PERSONAL-ASSISTANT): Per-Call-Kontext-Teilfelder. Hart gecappt gegen
  // Kosten/DoS/Injection (Leitplanke 6); briefing/constraints-Limits bleiben unberuehrt.
  "context.summary": 1000,
  "context.recipient_relationship": 200,
  "context.desired_outcome": 500,
  // P6: Mandats-Teilfelder. Gleicher Kosten-/DoS-Deckel-Gedanke wie context.*;
  // decide_freely traegt den Rahmen selbst, fallback_order nur eine Reihenfolge.
  "mandate.decide_freely": 1000,
  "mandate.fallback_order": 500,
};

// AL-P9: open_questions ("was ich nicht klaeren konnte", Eingabe fuer Phase 13). Gleiche
// Klasse wie key_facts, deshalb dieselbe Item-Zahl; maxLen groesser, weil eine Frage
// laenger ist als ein Stichwort. Bewusst grosszuegig: ein Cap-Verstoss laesst
// sanitizedBriefing (precall-briefing.js) die GANZE Briefing-Antwort verwerfen.
const OPEN_QUESTIONS_LIMITS = { maxItems: 10, maxLen: 300 };

// Fehlertext oder null; optionale Felder (null/undefined) sind erlaubt
export function invalidText(name, value) {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (value.length > TEXT_LIMITS[name])
    return `${name} ist zu lang (max. ${TEXT_LIMITS[name]} Zeichen)`;
  return null;
}

// Laengenbegrenztes String-Array: gleicher Vertrag wie invalidText (Fehlertext oder null).
// null/undefined = nicht gesetzt (erlaubt). limits = { maxItems, maxLen }: hoechstens
// maxItems Eintraege, jeder String <= maxLen Zeichen.
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

// Fehlertext oder null; optionale Enum-Felder (null/undefined) sind erlaubt. Gleicher
// Vertrag wie invalidText/invalidStringArray.
export function invalidEnum(name, value, allowed) {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (!allowed.includes(value)) return `${name} muss einer von ${allowed.join(", ")} sein`;
  return null;
}

// Nur die bekannten Teilfelder uebernehmen; leeres Ergebnis -> null (Block
// byte-identisch). EINE Quelle fuer context (P3) und mandate (P6): unbekannte Keys
// fallen weg -> Storage-/DoS-Deckel.
function pickKnownFields(raw, fields) {
  const out = {};
  for (const field of fields) if (raw[field] != null) out[field] = raw[field];
  return Object.keys(out).length ? out : null;
}

// Gemeinsames Geruest beider Teilobjekt-Validierer (parse-don't-validate): null -> null,
// Nicht-Objekt -> 400, unbekannte Keys weg, leer -> null. Die feldweisen Regeln bleiben
// beim Aufrufer (checkFields) - eine Aufgabe, eine Abstraktionsebene.
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

// P3-Kontext validieren UND normalisieren (parse-don't-validate): nimmt den rohen
// Body-Wert, weist Teilfeld-Verstoesse als 400 zurueck und gibt sonst ein Objekt aus NUR
// den fuenf bekannten Teilfeldern zurueck (unbekannte/uebergrosse Keys fallen weg ->
// Storage-/DoS-Deckel). { error } -> HTTP 400; { value } -> persistierbar (Objekt|null).
// EINE Quelle der Teilfeld-Regeln (kein Copy-Paste, G5): je Textfeld invalidText, die
// Arrays ueber invalidStringArray.
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

// P6: Vorab-Mandat. Gleicher Vertrag wie validateAssistantContext, andere Feldregeln.
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
