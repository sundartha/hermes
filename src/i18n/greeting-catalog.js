// Greeting-Katalog (P11, Umzug aus self-service.js - reine Verschiebung, Verhalten
// unveraendert). Der Katalog hat zwei Konsumenten auf verschiedenen Achsen: die
// Self-Service-Policy (self-service.js selfServicePatch/greetingTemplatesFor,
// self-service-routes.js) UND jetzt den Anruf-Render-Pfad (routes/voice.js, PROMPT-03).
// Er ist i18n-Inhalt, keine Self-Service-Regel - voice.js -> self-service.js waere eine
// Abhaengigkeit in die falsche Richtung.
// IP1: zusaetzlich die Karte der historischen DE-Schreibweisen (GREETING_ORTHOGRAPHY_MIGRATION)
// - zwei Konsumenten: greetingForLanguage (Anrufweg) und
// scripts/greeting-orthografie-nachziehen.mjs (At-Rest-Nachzug).
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

// ---- IP1: historische DE-Schreibweisen at rest ----------------------------------------
// Die DE-Vorlagen trugen bis IP1 die ASCII-Ersatzschreibung "fuer". Gespeicherte
// Begruessungen (settings.greeting) halten diese Fassungen weiter - ein Wert, der in KEINER
// Vorlagenliste mehr vorkommt, gilt unten als frei gesetzter Admin-Text und bliebe
// unveraendert. Diese Karte hebt genau die zwei historischen Fassungen auf die heutigen.
//
// EINGEFROREN UND GESCHLOSSEN: zwei Eintraege, beide DE (FR/EN hatten nie eine
// Transliteration). Die Schluessel sind HISTORIE - sie werden NIE an einen neuen Wortlaut
// nachgepflegt; wer den Wortlaut aendert, laesst diese Zeilen stehen.
// Kein waehlbarer Eintrag: die Schluessel stehen NICHT in greetingTemplatesFor und NICHT
// in ALL_GREETING_TEMPLATES (IP1-M3 pinnt das).
const HISTORISCHE_DE_ROHFASSUNGEN = Object.freeze([
  // Reihenfolge = buildTemplates: [0] greetingDefault, [1] greetingVariants[0].
  "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann eine Nachricht fuer {owner} aufnehmen. Wie kann ich helfen?",
  "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht fuer {owner} auf. Wie kann ich helfen?",
]);

// Schluessel = die UMHUELLTE Fassung, so wie sie at rest steht (defaults.js seedet
// DEFAULT_GREETING bereits umhuellt, und store/greeting-notice-migration.js umhuellt jede
// markerlose Bestandszeile beim Boot). Der Pflichtsatz wird KOMPONIERT, nicht ein zweites
// Mal literal hingeschrieben (G5) - dieselbe Zusammensetzung wie buildTemplates.
// Der NEUE Wert ist eine Referenz auf die gebaute Vorlage, keine Literal-Kopie (G5).
// Prototyplos (Object.create(null)): auf einem normalen Objekt lieferte der Lookup fuer
// einen at-rest-Wert wie "toString" eine Object.prototype-Funktion, die der Renderpfad
// (routes/voice.js, replaceAll) als String behandeln wuerde.
const GREETING_ORTHOGRAPHY_MIGRATION = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(
      HISTORISCHE_DE_ROHFASSUNGEN.map((alt, i) => [
        withInboundNotice(alt, LOCALES.de.inboundNotice),
        greetingTemplatesFor("de")[i],
      ]),
    ),
  ),
);

// Hebt eine gespeicherte Begruessung in HISTORISCHER Schreibweise auf die heutige Fassung.
// Rein, kein Nebeneffekt. Alles ausserhalb der Karte - frei gesetzter Text, null,
// undefined, Nicht-String - kommt unveraendert zurueck.
export function greetingWithCurrentOrthography(storedGreeting) {
  return GREETING_ORTHOGRAPHY_MIGRATION[storedGreeting] ?? storedGreeting;
}

// PROMPT-03: die gespeicherte Begruessung gilt nur, solange sie zur Sprache des Anrufs
// passt. Stammt sie aus dem Katalog EINER ANDEREN Sprache (Normalfall: der deutsche
// Seed-Default auf einem EN-/FR-Tenant), gewinnt die Standard-Vorlage der Anrufsprache.
// Ein frei gesetzter Text (Plattform-Admin, seit AUTH-P4 nur per direktem DB-Eingriff)
// bleibt unangetastet - er ist eine Entscheidung, keine Sprach-Altlast. Rein, kein
// Nebeneffekt.
export function greetingForLanguage(storedGreeting, language) {
  // IP1: ZUERST die historische Schreibweise heben, DANN gegen die Vorlagenlisten pruefen.
  // Umgekehrt waere jede nicht nachgezogene Bestandszeile "frei gesetzter Text": der
  // Anrufer hoerte die alte Schreibweise UND der Sprach-Fallback (PROMPT-03) griffe fuer
  // ihn nicht mehr - ein EN-Tenant bekaeme die deutsche Begruessung vorgelesen.
  const greeting = greetingWithCurrentOrthography(storedGreeting);
  const templates = greetingTemplatesFor(language);
  if (templates.includes(greeting)) return greeting;
  return ALL_GREETING_TEMPLATES.includes(greeting) ? templates[0] : greeting;
}
