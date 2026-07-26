// GAP-27 des i18n-Launch-Testkatalogs (Spezifikation in
// tasks/i18n-tests/11-luecken-und-e2e.md): Waechter gegen den MISCHSPRACH-PIN - eine
// byte-genaue Erwartung, die als nicht-deutsch ausgewiesen ist, aber deutschen Wortlaut
// traegt (der historische SP5-Fall: systemPrompt eines EN-Calls gegen eine deutsche
// Konstante gepinnt). Solche Pins zementieren einen Defekt als Sollzustand.
//
// REGEL (verbindlich): Ein byte-genauer Pin, dessen IST-Operand eine Nicht-DE-Sprache
// ausweist und dessen ERWARTUNGS-Operand deutschen Text enthaelt, ist nur zulaessig, wenn
// (a) Testname ODER Dateiname ihn als CHARAKTERISIERUNG kennzeichnet UND (b) dieselbe Datei
// einen Sprachreinheits-Eigenschaftstest gegen GERMAN_STOPWORDS traegt. Fehlt eines von
// beiden, ist es ein Befund.
//
// Das Subjekt ist bewusst auf den Mischsprach-Pin eingegrenzt und NICHT auf "jeden
// Nicht-DE-Byte-Pin": die heutigen Nicht-DE-Byte-Pins sind der Offenlegungssatz in EN/FR
// (eine absolute Regel aus CLAUDE.md, deren Byte-Pin erwuenscht ist) und kuratierte
// Bundle-Werte gerenderter Direktiven. Diese als "Charakterisierung" - also als
// vorlaeufigen Ist-Zustand - zu etikettieren waere aktiv schaedlich.
//
// BEWUSSTE GRENZEN (Ratschen-Mechanismus, kein Beweis). Der Waechter sieht NICHT:
//   1. Pins, deren Ist-Operand gar keine Sprachmarkierung traegt (z.B. eine
//      Inbound-Ablehnung ohne language-Argument);
//   2. berechnete Erwartungswerte (Funktionsaufruf statt Literal oder Konstante);
//   3. Template-Literale, deren deutscher Anteil aus einer Substitution stammt, die nicht
//      modulweit als "const NAME = <Literal>" deklariert ist.
//
// Reines Modul ohne Datei-I/O und ohne Import-Seiteneffekte: es bekommt QUELLTEXT, keine
// Pfade (DIP/F.I.R.S.T.-R). Das Einlesen bleibt in der Testdatei.
//
// LAENGENTREUE ist Pflicht: maskNonCode gibt eine Fassung zurueck, deren Offsets exakt
// denen von source entsprechen. Nur so duerfen Positionen aus der maskierten Fassung
// zurueck in den Rohtext gelesen werden.

import { GERMAN_STOPWORDS } from "../helpers.js"; // EINE Quelle fuer Deutsch-Erkennung (G5)

// --- benannte Konstanten ---
// Fallstrick F1: die Maskierung ersetzt durch NUL, NICHT durch Leerzeichen. Mit Leerzeichen
// frisst das "\s*" in MODULE_CONST_DECLARATION das gesamte maskierte Literal, und die
// Konstanten-Aufloesung liefert stumm nichts - der Waechter waere lautlos blind.
const CODE_MASK = "\u0000";
const MIN_PINNED_TEXT_LENGTH = 20; // kuerzere Erwartungen sind Codes/IDs, kein Text
const FINDING_EXCERPT_LENGTH = 120;
const EQUALITY_ASSERTION = /\bassert\.(equal|strictEqual|deepEqual|deepStrictEqual)\s*\(/g;
const TEST_DECLARATION = /\b(test|it)\s*\(/g;
const MODULE_CONST_DECLARATION = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*/gm;
const TEMPLATE_SUBSTITUTION = /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const NON_DE_LANGUAGE_MARKER = /LOCALES\.(en|fr)\b|["'`](en|fr|en-GB|en-US|fr-FR)["'`]/;
const DE_LANGUAGE_MARKER = /LOCALES\.de\b|["'`](de|de-DE)["'`]/;
const GERMAN_FUNCTION_WORDS =
  /[äöüÄÖÜß]|\b(der|die|das|und|nicht|ist|ein|eine|fuer|mit|von|dem|den|wird|muss|kein|keine|dass|sich|noch|oder|aber|nur|bitte|danke|Sie|Ihnen|Ihre|Uhr|Termin)\b/;
const CHARACTERIZATION_MARKER = /charakterisierung|characterization/i;
const PURITY_COMPANION = /\bGERMAN_STOPWORDS\b/;
// Zeichen, nach denen ein "/" eine Regex einleitet statt eine Division zu sein.
const REGEX_PRECEDING_CHARS = "(,=:[!&|?{};+-*~^%<>";

// ---------------------------------------------------------------------------
// Maskierung
// ---------------------------------------------------------------------------

function maskRange(chars, from, to) {
  for (let i = from; i < to; i++) {
    if (chars[i] !== "\n") chars[i] = CODE_MASK;
  }
}

function endOfLineComment(source, from) {
  const newline = source.indexOf("\n", from);
  return newline === -1 ? source.length : newline;
}

function endOfBlockComment(source, from) {
  const close = source.indexOf("*/", from + 2);
  return close === -1 ? source.length : close + 2;
}

function endOfQuoted(source, from) {
  const quote = source[from];
  let i = from + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === "\n") return i; // unterminiert - hier abbrechen statt weiterzufressen
    i++;
  }
  return source.length;
}

function endOfTemplate(source, from) {
  let i = from + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && source[i + 1] === "{") {
      i = endOfSubstitution(source, i + 2);
      continue;
    }
    i++;
  }
  return source.length;
}

function endOfSubstitution(source, from) {
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "`") {
      i = endOfTemplate(source, i);
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = endOfQuoted(source, i);
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    i++;
  }
  return i;
}

// Liefert das Ende inkl. Flags oder null, wenn die Regex nicht auf derselben Zeile schliesst
// (dann ist das "/" mit hoher Wahrscheinlichkeit eine Division).
function endOfRegex(source, from) {
  let i = from + 1;
  let inCharacterClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return null;
    if (ch === "[") inCharacterClass = true;
    else if (ch === "]") inCharacterClass = false;
    else if (ch === "/" && !inCharacterClass) return skipRegexFlags(source, i + 1);
    i++;
  }
  return null;
}

function skipRegexFlags(source, from) {
  let i = from;
  while (i < source.length && /[a-z]/.test(source[i])) i++;
  return i;
}

function literalRecord(source, from, to, isTemplate) {
  const text = source.slice(from + 1, to - 1);
  const substitutions = isTemplate
    ? [...text.matchAll(TEMPLATE_SUBSTITUTION)].map((m) => m[1])
    : [];
  return { text, index: from, end: to, substitutions };
}

/**
 * Maskiert Kommentare, String-/Template- und Regex-Literale LAENGENTREU (NUL statt Inhalt,
 * Zeilenumbrueche bleiben stehen). Die Delimiter der String-/Template-Literale bleiben
 * sichtbar, damit sich ein Literal in der maskierten Fassung noch als Wert erkennen laesst.
 * -> { code, literals: [{ text, index, end, substitutions }] }
 */
export function maskNonCode(source) {
  const chars = source.split("");
  const literals = [];
  let i = 0;
  let previousCodeChar = "";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && (next === "/" || next === "*")) {
      const end = next === "/" ? endOfLineComment(source, i) : endOfBlockComment(source, i);
      maskRange(chars, i, end);
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = ch === "`" ? endOfTemplate(source, i) : endOfQuoted(source, i);
      literals.push(literalRecord(source, i, end, ch === "`"));
      maskRange(chars, i + 1, end - 1);
      previousCodeChar = ch;
      i = end;
      continue;
    }
    if (ch === "/" && REGEX_PRECEDING_CHARS.includes(previousCodeChar || "(")) {
      const end = endOfRegex(source, i);
      if (end !== null) {
        maskRange(chars, i, end);
        i = end;
        continue;
      }
    }
    if (!/\s/.test(ch)) previousCodeChar = ch;
    i++;
  }
  return { code: chars.join(""), literals };
}

// ---------------------------------------------------------------------------
// Struktur-Extraktion
// ---------------------------------------------------------------------------

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** Testbloecke aus der maskierten Fassung: [{ name, from, to }] (name = erstes Literal). */
export function testBlocksOf(source) {
  const { code, literals } = maskNonCode(source);
  const starts = [...code.matchAll(TEST_DECLARATION)].map((m) => m.index);
  return starts.map((from, position) => {
    const to = position + 1 < starts.length ? starts[position + 1] : source.length;
    const name = literals.find((literal) => literal.index > from && literal.index < to);
    return { name: name ? name.text : "", from, to };
  });
}

// Haengt die Texte der ${IDENT}-Substitutionen an, damit ein Template wie
// `${DISCLOSURE_DE} Here's what...` in einem EN-Test als deutschtragend auffaellt.
// lookupText loest genau EINE Ebene auf (kein Zyklus moeglich).
function withSubstitutions(literal, lookupText) {
  const resolved = literal.substitutions.map(lookupText).filter(Boolean);
  return [literal.text, ...resolved].join(" ");
}

/** Modulweite "const NAME = <Literal>" -> Map<name, text> (Substitutionen eine Ebene tief). */
function constLiteralsOf(source) {
  const { code, literals } = maskNonCode(source);
  const literalsByName = new Map();
  for (const match of code.matchAll(MODULE_CONST_DECLARATION)) {
    const valueStart = match.index + match[0].length;
    const literal = literals.find((candidate) => candidate.index === valueStart);
    if (literal) literalsByName.set(match[1], literal);
  }
  const rawTextOf = (name) => literalsByName.get(name)?.text;
  return new Map(
    [...literalsByName].map(([name, literal]) => [name, withSubstitutions(literal, rawTextOf)]),
  );
}

// Argument-Spannen eines Aufrufs, klammer-balanciert ueber die MASKIERTE Fassung gescannt
// (maskierte Strings koennen die Klammer- und Komma-Zaehlung nicht mehr stoeren).
function argumentSpansOf(code, openIndex) {
  const spans = [];
  let depth = 0;
  let start = openIndex + 1;
  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      depth--;
      if (depth === 0) {
        spans.push({ from: start, to: i });
        return spans;
      }
    } else if (ch === "," && depth === 1) {
      spans.push({ from: start, to: i });
      start = i + 1;
    }
  }
  return spans;
}

// Fallstrick F2: der Rohtext kommt aus source, NICHT aus code - sonst waeren die
// Sprachmarker ("en"/"fr") in den Argumenten wegmaskiert und der Waechter blind.
function rawSpan(source, span) {
  return source.slice(span.from, span.to).trim();
}

function soleLiteralIn({ source, literals }, span) {
  const inside = literals.filter((literal) => literal.index >= span.from && literal.end <= span.to);
  if (inside.length !== 1) return null;
  const only = inside[0];
  const before = source.slice(span.from, only.index).trim();
  const after = source.slice(only.end, span.to).trim();
  return before === "" && after === "" ? only : null;
}

// Erwartungswert eines Pins: entweder genau ein Literal in der Spanne oder ein Bezeichner
// aus den modulweiten Konstanten. Alles andere (berechnete Werte) ist kein Byte-Pin.
function expectedTextOf(context, span) {
  const literal = soleLiteralIn(context, span);
  if (literal) return withSubstitutions(literal, (name) => context.constLiterals.get(name));
  const identifier = rawSpan(context.source, span);
  return context.constLiterals.get(identifier) ?? null;
}

/**
 * Gleichheits-Assertions mit aufgeloestem Erwartungswert:
 * [{ index, actual, expected }] - actual/expected als Rohtext aus source.
 */
function equalityPinsOf(source) {
  const { code, literals } = maskNonCode(source);
  const context = { source, literals, constLiterals: constLiteralsOf(source) };
  const pins = [];
  for (const match of code.matchAll(EQUALITY_ASSERTION)) {
    const openIndex = match.index + match[0].length - 1;
    const spans = argumentSpansOf(code, openIndex);
    if (spans.length < 2) continue;
    const expected = expectedTextOf(context, spans[1]);
    if (expected === null) continue;
    pins.push({ index: match.index, actual: rawSpan(source, spans[0]), expected });
  }
  return pins;
}

// Nackter Bezeichner als Ist-Operand -> die naechstgelegene vorangehende Zuweisung liefert
// die Sprachmarkierung (Muster: "const a = LOCALES.en.disclosure(x); assert.equal(a, ...)").
function declaredValueOf({ source, code }, name, beforeIndex) {
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*`, "g");
  let nearest = null;
  for (const match of code.matchAll(declaration)) {
    if (match.index < beforeIndex) nearest = match;
  }
  if (!nearest) return null;
  const valueStart = nearest.index + nearest[0].length;
  const semicolon = code.indexOf(";", valueStart);
  return source.slice(valueStart, semicolon === -1 ? code.length : semicolon);
}

function resolvedActualOf(context, pin) {
  if (!IDENTIFIER.test(pin.actual)) return pin.actual;
  return declaredValueOf(context, pin.actual, pin.index) ?? pin.actual;
}

function testNameAt(blocks, index) {
  const block = blocks.find((candidate) => index >= candidate.from && index < candidate.to);
  return block ? block.name : "";
}

// ---------------------------------------------------------------------------
// Regel
// ---------------------------------------------------------------------------

/** true, wenn text deutsche Funktionswoerter/Umlaute ODER GERMAN_STOPWORDS trifft. */
function containsGerman(text) {
  return GERMAN_FUNCTION_WORDS.test(text) || GERMAN_STOPWORDS.test(text);
}

/**
 * Alle byte-genauen Pins einer Datei, deren Ist-Operand eine Nicht-DE-Sprache ausweist.
 * Unabhaengig davon, ob der Erwartungswert deutsch ist - das ist das Lebendigkeits-Mass
 * fuer den Detektor.
 */
export function nonDeBytePinsOf({ source, fileName }) {
  const { code } = maskNonCode(source);
  const blocks = testBlocksOf(source);
  const pins = [];
  for (const pin of equalityPinsOf(source)) {
    if (pin.expected.length < MIN_PINNED_TEXT_LENGTH) continue;
    const actual = resolvedActualOf({ source, code }, pin);
    if (DE_LANGUAGE_MARKER.test(actual)) continue;
    if (!NON_DE_LANGUAGE_MARKER.test(actual)) continue;
    pins.push({
      fileName,
      line: lineOf(source, pin.index),
      testName: testNameAt(blocks, pin.index),
      expected: pin.expected,
    });
  }
  return pins;
}

function isProperlyMarked(pin, fileName, hasPurityCompanion) {
  const marked =
    CHARACTERIZATION_MARKER.test(pin.testName) || CHARACTERIZATION_MARKER.test(fileName);
  return marked && hasPurityCompanion;
}

/** Die Befunde nach der Regel oben: [{ fileName, line, testName, expected }]. */
export function characterizationFindings({ source, fileName }) {
  const hasPurityCompanion = PURITY_COMPANION.test(source);
  return nonDeBytePinsOf({ source, fileName })
    .filter((pin) => containsGerman(pin.expected))
    .filter((pin) => !isProperlyMarked(pin, fileName, hasPurityCompanion))
    .map((pin) => ({ ...pin, expected: pin.expected.slice(0, FINDING_EXCERPT_LENGTH) }));
}
