// Eingabe-Validierung fuer API-Routen (T4 Phase 2 — enabling refactor).
//
// Reine Konstanten/Funktionen ohne Netz-/config-Deps, aus src/server.js an ihren
// T4-Zielort verschoben (siehe docs/strategy/t4-server-decomposition.md §3.2 Klasse C).
// invalidText/TEXT_LIMITS leben lokal; E164 wird seit F2 aus store/defaults.js
// re-exportiert (reines Konstanten-Modul, keine Store-State-/Netz-Last zur Laufzeit).
// Von ZWEI API-Routen geteilt (/api/calls via E164+invalidText, /api/calendar via
// invalidText) -> eigenes Mini-Modul, von beiden importiert (G5: eine Quelle, kein
// Copy-Paste). Verhaltens-erhaltend: byte-identisch zur bisherigen server.js-Definition.

// E.164-Format: '+' gefolgt von 7-15 Ziffern, erste Ziffer != 0. Kanonisch in
// store/defaults.js neben normNum (EINE Quelle, G5 - F2 brauchte denselben Regex im
// private-number-Setter; statt einer zweiten Kopie re-exportieren wir hier). Die
// bestehenden Konsumenten (server.js /api/calls) importieren E164 unveraendert von hier.
export { E164 } from "../store/defaults.js";
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
};

// P3: key_facts ist ein laengenbegrenztes String-Array. Die beiden Deckel reisen als EIN
// Limit-Objekt (F1: <=3 Args). Benannte Konstanten statt nackter Zahlen (G25); Hoehe =
// Kosten-/DoS-Deckel analog TEXT_LIMITS, im Review justierbar.
const KEY_FACTS_LIMITS = { maxItems: 10, maxLen: 200 };

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

// Nur die vier bekannten Teilfelder uebernehmen; leeres Ergebnis -> null (Block
// byte-identisch). Typ-/Laengenpruefung passiert danach in validateAssistantContext.
function pickContext(raw) {
  const out = {};
  if (raw.summary != null) out.summary = raw.summary;
  if (raw.recipient_relationship != null) out.recipient_relationship = raw.recipient_relationship;
  if (raw.desired_outcome != null) out.desired_outcome = raw.desired_outcome;
  if (raw.key_facts != null) out.key_facts = raw.key_facts;
  return Object.keys(out).length ? out : null;
}

// P3-Kontext validieren UND normalisieren (parse-don't-validate): nimmt den rohen
// Body-Wert, weist Teilfeld-Verstoesse als 400 zurueck und gibt sonst ein Objekt aus NUR
// den vier bekannten Teilfeldern zurueck (unbekannte/uebergrosse Keys fallen weg ->
// Storage-/DoS-Deckel). { error } -> HTTP 400; { value } -> persistierbar (Objekt|null).
// EINE Quelle der Teilfeld-Regeln (kein Copy-Paste, G5): je Textfeld invalidText, das
// Array ueber invalidStringArray.
export function validateAssistantContext(raw) {
  if (raw == null) return { value: null };
  if (typeof raw !== "object" || Array.isArray(raw))
    return { error: "context muss ein Objekt sein" };
  const value = pickContext(raw);
  if (value == null) return { value: null };
  const error =
    invalidText("context.summary", value.summary) ||
    invalidText("context.recipient_relationship", value.recipient_relationship) ||
    invalidText("context.desired_outcome", value.desired_outcome) ||
    invalidStringArray("context.key_facts", value.key_facts, KEY_FACTS_LIMITS);
  return error ? { error } : { value };
}
