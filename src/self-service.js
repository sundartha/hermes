// Self-Service-Settings: eine STRENGERE Whitelist als POST /api/settings (Admin).
// Reine, IO-freie Logik (P2/G34): filtert einen Settings-Patch auf das, was ein
// Tenant SELBST aendern darf, BEVOR store.updateSettings (die Admin-Whitelist)
// laeuft. updateSettings wird NICHT aufgeweicht - diese Schicht liegt davor.

import { LOCALES, SUPPORTED_LANGUAGES, localeFor } from "./i18n/locales.js";
import { withInboundNotice } from "./i18n/inbound-notice.js";

// Felder, die ein Tenant SELBST setzen darf - updateSettings ist die EINE Validierungs-
// quelle (G5): einfache Felder werden dort typeof-gecheckt, die optionalen Enum-Overrides
// language UND agentStyle fail-closed gegen ihren Katalog (SUPPORTED_LANGUAGES bzw. das P2-
// Enum PERSONA_STYLE_IDS) ueber OPTIONAL_ENUM_FIELDS/isOptionalEnumOverride. "" / null setzt
// das Override zurueck (= "automatisch" bzw. Standardstil), ein Muellwert wird still
// verworfen - kein Freitext, kein PII/Impersonation im Feld. language ist seit F1 P4
// uebersteuerbar (Entscheidung #8), agentStyle seit PA P4 nach exakt gleichem Muster (kein
// eigener Sonderbranch mehr - die Katalog-Pruefung lebt einmal in updateSettings, nicht hier).
// allowCalendar/allowBooking sind seit P1b KEINE Self-Service-Felder mehr: der
// Telefon-Agent hat weder Kalender- noch Buchungs-Tool, ein Schalter dafuer waere
// ein Angebot ohne Wirkung (E1). Die Felder bleiben im Datenmodell und nur ueber
// POST /api/settings (Plattform-Admin) schreibbar.
export const SELF_SERVICE_FREE_FIELDS = ["agentName", "language", "agentStyle"];

// Permission-Flags, die ein Tenant NUR restriktiver setzen darf (true->false ja,
// false->true NEIN - Aktivieren bleibt Plattform-Admin via POST /api/settings).
export const SELF_SERVICE_RESTRICT_ONLY_FIELDS = ["allowPersonalData", "allowBankData"];

// Kuratierte greeting-Vorlagen (kein Freitext ueber Self-Service, PII-/Missbrauchs-
// Riegel, Decision #7). {owner} wird zur Laufzeit ersetzt wie heute. Der Disclosure-
// Satz ist NICHT Teil des greeting und bleibt fest verdrahtet (Regel 2).
//
// WEB-04: die Vorlagenmenge FOLGT der Tenant-Sprache. Der Vorlagen-Riegel selbst (nur
// Vorlage, kein Freitext) bleibt unangetastet. Jede Vorlage traegt den Pflichtsatz
// (GAP-14); zusammengesetzt statt fuer jede Sprache literal gepflegt (G5). Einmalig beim
// Laden gebaut und eingefroren - kein Lazy-Init (P15), keine Allokation je Request.
function buildTemplates(locale) {
  return Object.freeze(
    [locale.greetingDefault, ...locale.greetingVariants].map((t) =>
      withInboundNotice(t, locale.inboundNotice),
    ),
  );
}

const GREETING_TEMPLATES_BY_LANGUAGE = Object.freeze(
  Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [lang, buildTemplates(LOCALES[lang])])),
);

// Die waehlbaren Vorlagen EINER Sprache (unbekannt -> Fallback wie localeFor).
export function greetingTemplatesFor(language) {
  return GREETING_TEMPLATES_BY_LANGUAGE[localeFor(language).language];
}

// Alle kuratierten Vorlagen ueber alle Sprachen - die Annahme-Menge von selfServicePatch.
// Bewusst sprach-UNION: ein Patch darf language und greeting GLEICHZEITIG umstellen; eine
// Pruefung gegen die alte Sprache wuerde genau diesen Wechsel-Patch verwerfen.
export const ALL_GREETING_TEMPLATES = Object.freeze(
  Object.values(GREETING_TEMPLATES_BY_LANGUAGE).flat(),
);

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
      // greeting ist KEIN Enum-Override in updateSettings (dort nur typeof-gecheckt, jeder
      // String passiert) - die Vorlagen-Pruefung MUSS daher hier stattfinden (G5: kein Dup,
      // weil updateSettings diese Filterung nicht hat). agentStyle/language dagegen liegen in
      // SELF_SERVICE_FREE_FIELDS, weil updateSettings sie selbst fail-closed katalog-validiert.
      if (ALL_GREETING_TEMPLATES.includes(value)) clean[key] = value;
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

// Pay3: abgeleiteter Karten-Status fuer die UI-Sichtbarkeit. Eine Karte gilt erst
// als hinterlegt, sobald ein payment_method gespeichert ist (customerId allein
// reicht nicht - der Checkout kann abgebrochen worden sein). Reiner Praedikat-Helfer
// (kein IO, kein id-Leak nach aussen - liefert nur boolean). stripe = das Ergebnis
// von store.tenantStripe (stets { customerId, paymentMethodId }).
export function hasCardOnFile(stripe) {
  return Boolean(stripe && stripe.paymentMethodId);
}
