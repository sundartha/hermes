// Self-Service-Settings: eine STRENGERE Whitelist als POST /api/settings (Admin).
// Reine, IO-freie Logik (P2/G34): filtert einen Settings-Patch auf das, was ein
// Tenant SELBST aendern darf, BEVOR store.updateSettings (die Admin-Whitelist)
// laeuft. updateSettings wird NICHT aufgeweicht - diese Schicht liegt davor.

import { DEFAULT_GREETING } from "./store/defaults.js";

// Felder, die ein Tenant frei (Typ-gecheckt von updateSettings) setzen darf.
export const SELF_SERVICE_FREE_FIELDS = ["agentName", "allowCalendar", "allowBooking"];

// Permission-Flags, die ein Tenant NUR restriktiver setzen darf (true->false ja,
// false->true NEIN - Aktivieren bleibt Plattform-Admin via POST /api/settings).
export const SELF_SERVICE_RESTRICT_ONLY_FIELDS = ["allowPersonalData", "allowBankData"];

// Kuratierte greeting-Vorlagen (kein Freitext ueber Self-Service, PII-/Missbrauchs-
// Riegel, Decision #7). {owner} wird zur Laufzeit ersetzt wie heute. Der Disclosure-
// Satz ist NICHT Teil des greeting und bleibt fest verdrahtet (Regel 2).
export const GREETING_TEMPLATES = Object.freeze([
  DEFAULT_GREETING, // = der geseedete Default; eine Quelle in defaults.js (G5, kein Drift)
  "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht auf oder vereinbare einen Termin. Wie kann ich helfen?",
  "Hallo! Der KI-Assistent von {owner} hier. Wie kann ich Ihnen weiterhelfen?",
]);

// Filtert einen rohen Patch auf den Self-Service-erlaubten Anteil. current = die
// aktuellen Settings des Tenants (fuer den restrict-only-Vergleich). Liefert den
// engeren Patch + die abgelehnten Keys (fuers Audit, ohne Werte). KEIN Nebeneffekt
// (P6/N7): mutiert nichts, gibt nur das gefilterte Objekt zurueck.
export function selfServicePatch(patch, current) {
  const clean = {};
  const rejected = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (SELF_SERVICE_FREE_FIELDS.includes(key)) {
      clean[key] = value; // Typ-Check macht updateSettings
    } else if (key === "greeting") {
      if (GREETING_TEMPLATES.includes(value)) clean[key] = value;
      else rejected.push(key); // Freitext -> abgelehnt (nur Vorlage)
    } else if (SELF_SERVICE_RESTRICT_ONLY_FIELDS.includes(key)) {
      // Nur restriktiver: true->false ja, false->true NEIN. Hochheben abgelehnt.
      if (value === false || current[key] === true) clean[key] = value;
      else rejected.push(key);
    } else {
      rejected.push(key); // alles andere (allowSummaries, disclosure-*, Unbekanntes)
    }
  }
  return { clean, rejected };
}
