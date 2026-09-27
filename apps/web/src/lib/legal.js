// Rechtsdokumente: EINE Quelle fuer Slugs, Routen, Sprachwahl und Vorrangklausel
// (O13: DE ist die verbindliche Fassung, EN eine informative Uebersetzung).
// Bewusst OHNE Datei- oder Vite-Zugriff (kein fs, kein import.meta.glob), damit
// dieselben Funktionen im Astro-Build UND im reinen node-Test laufen (Muster:
// lib/plans.js). Das Content-Verzeichnis kennt ausschliesslich legal-content.js.

// DE ist die einzige rechtsverbindliche Sprache. Nicht-verbindliche Fassungen
// duerfen keine eigene Vorrangklausel (note) mitbringen (D5).
export const BINDING_LEGAL_LANGUAGE = "de";

// Reihenfolge = Footer-Reihenfolge (heutiger Bestand: Privacy, Imprint, Terms).
export const LEGAL_DOCUMENTS = Object.freeze([
  Object.freeze({
    slug: "privacy",
    label: "Privacy",
    paths: Object.freeze({ de: "/datenschutz", en: "/legal/privacy" }),
  }),
  Object.freeze({
    slug: "imprint",
    label: "Imprint",
    paths: Object.freeze({ de: "/impressum", en: "/legal/imprint" }),
  }),
  Object.freeze({
    slug: "terms",
    label: "Terms",
    paths: Object.freeze({ de: "/agb", en: "/legal/terms" }),
  }),
]);

export const LEGAL_SLUGS = Object.freeze(LEGAL_DOCUMENTS.map((doc) => doc.slug));

// Fester Vorranghinweis fuer nicht-verbindliche Fassungen. Bewusst rein
// hinweisend, keine eigene Rechtsaussage - der bestellte Text ersetzt sie in
// einer Zeile (Phasenrisiko 2, s. Plan Abschnitt 7).
export const LEGAL_TRANSLATION_NOTICE =
  "This is an informative English translation. Only the German version is legally binding.";

const LEGAL_FILE_NAME_PATTERN = /([a-z]+)\.([a-z]{2})\.json$/;

// Pflichtfelder eines Rechtsdokuments (D7: unvollstaendig -> Build bricht ab).
function assertNonEmptyString(value, fieldName, filePath) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Rechtsdokument ${filePath}: Feld "${fieldName}" fehlt oder ist leer`);
  }
}

function assertNonEmptySections(sections, filePath) {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error(`Rechtsdokument ${filePath}: "sections" fehlt oder ist leer`);
  }
  for (const section of sections) {
    assertNonEmptyString(section.heading, "sections[].heading", filePath);
    assertNonEmptyString(section.text, "sections[].text", filePath);
  }
}

// Vorrangklausel ist Code-Konstante, nicht Uebersetzer-Content (D5): eine
// nicht-verbindliche Fassung darf kein eigenes "note"-Feld mitbringen.
function assertNoOwnTranslationNotice(doc, lang, filePath) {
  if (lang !== BINDING_LEGAL_LANGUAGE && doc.note !== undefined) {
    throw new Error(
      `Rechtsdokument ${filePath}: nicht-verbindliche Fassung (${lang}) darf kein eigenes "note"-Feld haben`,
    );
  }
}

function assertValidLegalDocument(doc, filePath, lang) {
  assertNonEmptyString(doc.metaTitle, "metaTitle", filePath);
  assertNonEmptyString(doc.metaDescription, "metaDescription", filePath);
  assertNonEmptyString(doc.eyebrow, "eyebrow", filePath);
  assertNonEmptyString(doc.title, "title", filePath);
  assertNonEmptySections(doc.sections, filePath);
  assertNoOwnTranslationNotice(doc, lang, filePath);
}

// Jeder bekannte Slug braucht eine verbindliche (DE-)Fassung (D7): das
// Impressum darf nie versehentlich verschwinden.
function assertBindingVersionsComplete(content) {
  const missing = LEGAL_SLUGS.filter((slug) => !content[slug]?.[BINDING_LEGAL_LANGUAGE]);
  if (missing.length > 0) {
    throw new Error(
      `Rechtsdokumente: verbindliche ${BINDING_LEGAL_LANGUAGE}-Fassung fehlt fuer: ${missing.join(", ")}`,
    );
  }
}

function parseLegalFileName(filePath) {
  const match = LEGAL_FILE_NAME_PATTERN.exec(filePath);
  if (!match) return null;
  return { slug: match[1], lang: match[2] };
}

// Indiziert die per Glob geladenen Rechtsdokument-Module nach Slug und Sprache.
// Fail-closed: unbekanntes Dateischema, unbekannter Slug oder unvollstaendiges
// Dokument werfen sofort (Astro-Build bricht ab, D7).
export function indexLegalContent(modulesByPath) {
  const content = {};
  for (const [filePath, doc] of Object.entries(modulesByPath)) {
    const parsed = parseLegalFileName(filePath);
    if (!parsed) {
      throw new Error(`Rechtsdokument ${filePath}: Dateiname folgt nicht dem Schema <slug>.<lang>.json`);
    }
    const { slug, lang } = parsed;
    if (!LEGAL_SLUGS.includes(slug)) {
      throw new Error(`Rechtsdokument ${filePath}: unbekannter Slug "${slug}"`);
    }
    assertValidLegalDocument(doc, filePath, lang);
    content[slug] = content[slug] || {};
    content[slug][lang] = doc;
  }
  assertBindingVersionsComplete(content);
  return content;
}

// Liefert das Dokument fuer Slug+Sprache, KEIN Sprach-Fallback (D4): fehlt die
// Uebersetzung, liefert dies null statt still die DE-Fassung auszugeben.
export function findLegalDocument(content, slug, lang) {
  return content[slug]?.[lang] ?? null;
}

// Wie findLegalDocument, wirft aber statt null zu liefern (Pflichtseiten wie
// die deutschen Rechtsseiten duerfen nie fehlend rendern, D7).
export function requireLegalDocument(content, slug, lang) {
  const doc = findLegalDocument(content, slug, lang);
  if (!doc) {
    throw new Error(`Rechtsdokument fehlt: Slug "${slug}", Sprache "${lang}"`);
  }
  return doc;
}

// getStaticPaths-Eintraege fuer eine Sprache: nur Slugs, fuer die tatsaechlich
// ein Dokument geliefert wurde. Ohne Datei entsteht keine Route -> 404 (O13).
export function legalRouteEntries(content, lang) {
  return LEGAL_SLUGS.filter((slug) => findLegalDocument(content, slug, lang)).map((slug) => ({
    slug,
    doc: findLegalDocument(content, slug, lang),
  }));
}

// Footer-Rechtslinks fuer eine Seitensprache: zeigt auf die uebersetzte Route,
// wenn sie existiert, sonst auf die verbindliche DE-Route (D10) - ein toter
// Link kann so nicht entstehen. slug: damit ein Link im Rechts-Blatt der Startseite
// den passenden Reiter oeffnen kann (components/site/SupportInfo.astro).
export function legalFooterLinks(content, lang) {
  return LEGAL_DOCUMENTS.map((entry) => {
    const hasTranslation = Boolean(findLegalDocument(content, entry.slug, lang));
    const targetLang = hasTranslation ? lang : BINDING_LEGAL_LANGUAGE;
    return { slug: entry.slug, href: entry.paths[targetLang], label: entry.label };
  });
}
