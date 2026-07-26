// Greeting-Katalog (P11, Umzug aus self-service.js - reine Verschiebung, Verhalten
// unveraendert). Der Katalog hat zwei Konsumenten auf verschiedenen Achsen: die
// Self-Service-Policy (self-service.js selfServicePatch/greetingTemplatesFor,
// self-service-routes.js) UND jetzt den Anruf-Render-Pfad (routes/voice.js, PROMPT-03).
// Er ist i18n-Inhalt, keine Self-Service-Regel - voice.js -> self-service.js waere eine
// Abhaengigkeit in die falsche Richtung.
import { LOCALES, SUPPORTED_LANGUAGES, localeFor } from "./locales.js";
import { withInboundNotice } from "./inbound-notice.js";

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

// PROMPT-03: die gespeicherte Begruessung gilt nur, solange sie zur Sprache des Anrufs
// passt. Stammt sie aus dem Katalog EINER ANDEREN Sprache (Normalfall: der deutsche
// Seed-Default auf einem EN-/FR-Tenant), gewinnt die Standard-Vorlage der Anrufsprache.
// Ein frei gesetzter Text (Plattform-Admin ueber POST /api/settings) bleibt unangetastet -
// er ist eine Entscheidung, keine Sprach-Altlast. Rein, kein Nebeneffekt.
export function greetingForLanguage(storedGreeting, language) {
  const templates = greetingTemplatesFor(language);
  if (templates.includes(storedGreeting)) return storedGreeting;
  return ALL_GREETING_TEMPLATES.includes(storedGreeting) ? templates[0] : storedGreeting;
}
