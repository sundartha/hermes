// O-14 (developers.openai.com/apps-sdk/app-submission-guidelines, "Do not collect,
// solicit, or process the following categories of Restricted Data"): Erkennung UND
// Maskierung von Restricted Data an der MCP-Grenze. Reine Funktionen - kein Store, kein
// IO, kein Seiteneffekt, kein Log. Zwei Konsumenten teilen sich diese Datei
// (Eingabepruefung UND Ausgabe-Maskierung in src/mcp-tools.js) - EINE Quelle fuer "was
// gilt als Restricted Data" (G5).
//
// Was erkannt wird (Sprachen de/en/fr):
//   1. Zahlungskarten: 15-19 Ziffern (13-14 nur mit Kartenwort), IIN 2-6, Luhn, in den Schreibweisen
//      zusammenhaengend, 4er-Gruppen (Leerzeichen/Bindestrich/Punkt/Komma, einheitlich),
//      Amex 4-6-5, Diners 4-6-4.
//   2. Behoerdliche Kennnummern NUR mit Beschriftung: ein Label (SSN, Steuer-ID,
//      Passnummer, numero de securite sociale, ...) direkt vor einem Wert mit mindestens
//      GOVERNMENT_ID_MIN_DIGITS Ziffern.
//   3. Zugangsdaten: private Schluessel (PEM-Kopfzeile), Tokens mit festem Anbieter-Praefix
//      (AWS, GitHub, Slack, Stripe, Google, sk-Keys, JWT; Laenge nach oben offen, immer das
//      ganze Token) UND beschriftete Werte (Passwort/PIN/TAN/OTP/Einmalcode + Trenner + Wert).
//
// Ehrliche Grenzen (bewusst, s. PLAN-SECURITY.md und docs/OPENAI-POLICY-ABGLEICH.md):
//   - Gesundheitsdaten (PHI) werden NICHT erkannt. Es gibt keine Struktur, und eine
//     Stichwort-Sperre traefe genau die erlaubten Faelle ("Zahnarzttermin wegen
//     Zahnschmerzen") - Angaben, die fuer einen Arzttermin noetig sind, sind laut
//     Richtlinie zulaessig ("strictly necessary").
//   - Eine unbeschriftete Kennnummer (nur Ziffern, kein Label) ist von einer Kunden-,
//     Bestell- oder Rufnummer nicht unterscheidbar und wird NICHT erkannt.
//   - Ein beschriftetes Passwort NUR aus Buchstaben ("Passwort ist Sonnenschein") wird
//     NICHT erkannt - sonst traefe die Regel Alltagssaetze wie "die PIN ist gesperrt".
//   - IBAN/Bankkonto ist KEINE Kategorie der Richtlinie und wird bewusst weder erkannt
//     noch abgelehnt noch maskiert (die Bankdaten-Freigabe allowBankData bleibt nutzbar).
//     Eine gueltige IBAN wird nur gesucht, damit ihre Ziffern nicht als Karte gelten.
//   - Kartennummern als Zahlwoerter oder in Paar-/Dreiergruppen (typische Diktat-
//     Transkription) werden nicht erkannt.

export const RESTRICTED_CATEGORY = Object.freeze({
  PAYMENT_CARD: "payment_card",
  GOVERNMENT_ID: "government_id",
  CREDENTIAL_SECRET: "credential_secret",
});

// ---- Gemeinsame Bausteine ----

// Unicode-Wortgrenzen statt \b: \b kennt nur ASCII-Wortzeichen und bricht deshalb an
// "Rückrufnummer" (nach "R" folgt ein Nicht-ASCII-Buchstabe). Diese Grenzen verhindern
// zugleich Teilwort-Treffer wie "pin" in "Pinnwand" oder "tan" in "Tankstelle".
const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";

function wordAlternationSource(sources) {
  return `${WORD_START}(?:${sources.join("|")})${WORD_END}`;
}

function digitCount(raw) {
  return raw.replace(/\D/g, "").length;
}

// ---- 1. Zahlungskarten ----

const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;
const CARD_GROUP_SIZE = 4;
const AMEX_MIDDLE_GROUP_SIZE = 6;
const AMEX_LAST_GROUP_SIZE = 5;
const DINERS_MIDDLE_GROUP_SIZE = 6;
const AMEX_GROUP_SIZES = Object.freeze([CARD_GROUP_SIZE, AMEX_MIDDLE_GROUP_SIZE, AMEX_LAST_GROUP_SIZE]);
const DINERS_GROUP_SIZES = Object.freeze([CARD_GROUP_SIZE, DINERS_MIDDLE_GROUP_SIZE, CARD_GROUP_SIZE]);
const CARD_LAST_DIGITS_SHOWN = 4;
const CARD_IIN_MIN = "2";
const CARD_IIN_MAX = "6";
const LUHN_DOUBLE_FACTOR = 2;
const LUHN_SUBTRACT_THRESHOLD = 9;
const LUHN_MOD_BASE = 10;
// Umfeld einer Ziffernfolge fuer Kontext- und Kartenwoerter; reicht fuer
// "Numéro de téléphone : " (22 Zeichen) bzw. "Rückrufnummer ist " vor der Zahl.
const CONTEXT_WINDOW_CHARS = 32;
// 13- und 14-stellige Folgen sind haeufig Rufnummern ohne '+' ("4915112345678") oder
// Referenznummern - als Karte gelten sie NUR mit Kartenwort im Umfeld. Ab 15 Ziffern
// genuegen Form und Pruefsumme (betrifft auch 14-stellige Diners-Karten).
const CARD_MIN_DIGITS_WITHOUT_CARD_WORD = 15;

// Kandidat: 12-19 Ziffern (11-18 weitere hinter der ersten), dazwischen je hoechstens EIN Trenner
// (Leerzeichen, Bindestrich, Punkt oder Komma - Punkt/Komma optional mit Leerzeichen,
// Diktatform "4111, 1111, 1111, 1111"). Kein Doppelpunkt/Schraegstrich (Uhrzeit/Datum).
// Jede Wiederholung verbraucht genau eine Ziffer - linear, kein Backtracking-Aufwand. Die
// Feinregeln (einheitlicher Trenner, Gruppenform, IIN, Laenge, Luhn) laufen danach.
const CARD_CANDIDATE = /(?<![+\d])\d(?:(?:[ -]|[.,] ?)?\d){11,18}(?!\d)/g;

// Rufnummern- und Referenz-Kontext: eine unformatierte Rufnummer ohne '+' oder eine
// Auftrags-/Kundennummer ist von einer Kartennummer nicht unterscheidbar (ca. 10 % aller
// Ziffernfolgen sind Luhn-gueltig). Steht ein solches Wort in den CONTEXT_WINDOW_CHARS
// Zeichen davor, kann eine UNFORMATIERTE Folge von der Kartenpruefung ausgenommen sein
// (Bedingungen je Wortart s. requiredCardDigits) - bewusst KEIN blosses "Nummer" (Teil von
// "Kartennummer").
const PHONE_CONTEXT_WORDS = Object.freeze([
  "r(?:ü|ue)ckruf(?:nummer)?",
  "rufnummer",
  "telefon(?:nummer)?",
  "tel\\.?",
  "handy(?:nummer)?",
  "mobil(?:e|nummer)?",
  "durchwahl",
  "erreichbar unter",
  "phone(?: number)?",
  "call(?: me)? back",
  "callback(?: number)?",
  "reach me at",
  "num[ée]ro de t[ée]l[ée]phone",
  "t[ée]l[ée]phone",
  "portable",
  "rappel",
  "joignable",
]);
const REFERENCE_CONTEXT_WORDS = Object.freeze([
  "auftragsnummer",
  "bestellnummer",
  "kundennummer",
  "rechnungsnummer",
  "vorgangsnummer",
  "aktenzeichen",
  "order number",
  "reference",
  "invoice",
  "booking",
  "num[ée]ro de commande",
  "num[ée]ro client",
  "facture",
]);
const PHONE_CONTEXT_PATTERN = new RegExp(wordAlternationSource(PHONE_CONTEXT_WORDS), "iu");
const REFERENCE_CONTEXT_PATTERN = new RegExp(wordAlternationSource(REFERENCE_CONTEXT_WORDS), "iu");
// E.164: eine Rufnummer hat hoechstens 15 Ziffern - eine laengere Folge ist keine Rufnummer.
const PHONE_MAX_DIGITS = 15;

// Praefixbereiche der Kartenmarken (je [von, bis], gleich lange Ziffernfolgen, Vergleich
// als Zeichenkette). Eine Referenznummer in einem dieser Bereiche ist von einer Karte
// nicht zu unterscheiden - dort gibt ein Referenzwort die Folge NICHT frei.
const CARD_BRAND_PREFIX_RANGES = Object.freeze({
  visa: [["4", "4"]],
  mastercard: [["51", "55"], ["2221", "2720"]],
  amex: [["34", "34"], ["37", "37"]],
  discover: [["6011", "6011"], ["644", "649"], ["65", "65"]],
  diners: [["36", "36"], ["38", "38"], ["300", "305"]],
  jcb: [["3528", "3589"]],
  unionpay: [["62", "62"]],
  maestro: [["50", "50"], ["56", "69"]],
});

function hasCardBrandPrefix(digits) {
  return Object.values(CARD_BRAND_PREFIX_RANGES)
    .flat()
    .some(([low, high]) => {
      const prefix = digits.slice(0, low.length);
      return prefix >= low && prefix <= high;
    });
}

// Kartenwoerter als TEILSTRING (nicht an Wortgrenzen): "karte" deckt "Kreditkarte" und
// "Kartennummer", "card" deckt "credit card", "carte" deckt "carte bancaire". Die
// grosszuegige Suche wirkt nur in die sichere Richtung - ein Kartenwort gewinnt immer.
const CARD_CONTEXT_STEMS = Object.freeze(["card", "carte", "karte"]);

// Ausnahmen fuer eine UNFORMATIERTE Folge ohne Kartenwort (eine gruppierte Folge
// "4111 1111 ..." ist keine Ruf- oder Referenznummernschreibweise):
// - Rufnummernwort davor und hoechstens PHONE_MAX_DIGITS Ziffern. Unabhaengig vom
//   Markenpraefix, weil Laendervorwahlen die Kartenbereiche ueberlagern (+49 liegt im
//   Visa-Bereich 4) - eine Praefixbedingung wuerde die Ausnahme fuer Rufnummern aufheben.
// - Referenzwort davor und KEIN Markenpraefix: in einem Kartenbereich gewinnt die Karte.
function isExemptByContext(candidate, before) {
  if (/\D/.test(candidate.raw)) return false;
  const isPhone = PHONE_CONTEXT_PATTERN.test(before) && candidate.raw.length <= PHONE_MAX_DIGITS;
  const isReference = REFERENCE_CONTEXT_PATTERN.test(before) && !hasCardBrandPrefix(candidate.raw);
  return isPhone || isReference;
}

// Mindestzahl an Ziffern, ab der dieser Kandidat als Karte gilt - oder null (kein
// Kartenverdacht). Ein Kartenwort vor ODER hinter der Folge gewinnt immer (13 Ziffern
// genuegen); sonst gelten die Kontext-Ausnahmen oben, und ab 15 Ziffern besteht Verdacht.
function requiredCardDigits(text, candidate) {
  const before = text.slice(Math.max(0, candidate.start - CONTEXT_WINDOW_CHARS), candidate.start);
  const after = text.slice(candidate.end, candidate.end + CONTEXT_WINDOW_CHARS);
  const surrounding = `${before} ${after}`.toLowerCase();
  if (CARD_CONTEXT_STEMS.some((stem) => surrounding.includes(stem))) return CARD_MIN_DIGITS;
  return isExemptByContext(candidate, before) ? null : CARD_MIN_DIGITS_WITHOUT_CARD_WORD;
}

function hasUniformSeparator(raw) {
  return new Set(raw.match(/\D+/g) ?? []).size <= 1;
}

function groupSizesMatch(groups, sizes) {
  return groups.length === sizes.length && sizes.every((size, index) => groups[index].length === size);
}

// Zusammenhaengend, ODER 4er-Gruppen (letzte 1-4), ODER Amex 4-6-5, ODER Diners 4-6-4.
// Datumsfolgen ("2026-09-25 2026-09-26") fallen hier durch.
function hasCardGroupShape(raw) {
  const groups = raw.split(/\D+/);
  if (groups.length === 1) return true;
  if (groupSizesMatch(groups, AMEX_GROUP_SIZES) || groupSizesMatch(groups, DINERS_GROUP_SIZES)) return true;
  const lastGroupLength = groups.at(-1).length;
  const leadingGroupsFull = groups.slice(0, -1).every((group) => group.length === CARD_GROUP_SIZE);
  return leadingGroupsFull && lastGroupLength <= CARD_GROUP_SIZE;
}

// Luhn-Pruefsumme (ISO/IEC 7812-1).
function luhnValid(digits) {
  let sum = 0;
  let doubled = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (doubled) digit *= LUHN_DOUBLE_FACTOR;
    if (digit > LUHN_SUBTRACT_THRESHOLD) digit -= LUHN_SUBTRACT_THRESHOLD;
    sum += digit;
    doubled = !doubled;
  }
  return sum % LUHN_MOD_BASE === 0;
}

function isCardNumber(raw, minDigits) {
  if (!hasUniformSeparator(raw) || !hasCardGroupShape(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  const lengthOk = digits.length >= minDigits && digits.length <= CARD_MAX_DIGITS;
  const iinOk = digits[0] >= CARD_IIN_MIN && digits[0] <= CARD_IIN_MAX;
  return lengthOk && iinOk && luhnValid(digits);
}

// Scheitert der volle Kandidat (z.B. weil eine CVV-Gruppe oder eine fremde Zahl direkt
// anschliesst), werden zusammenhaengende Gruppenfenster fallend nach Groesse geprueft.
// Hoechstens ~19 Gruppen je Kandidat - die Doppelschleife bleibt klein.
function bestCardWindow(raw, minDigits) {
  if (isCardNumber(raw, minDigits)) return { start: 0, end: raw.length };
  const groups = [...raw.matchAll(/\d+/g)].map((group) => ({ start: group.index, end: group.index + group[0].length }));
  for (let size = groups.length - 1; size >= 1; size--) {
    for (let first = 0; first + size <= groups.length; first++) {
      const window = { start: groups[first].start, end: groups[first + size - 1].end };
      if (isCardNumber(raw.slice(window.start, window.end), minDigits)) return window;
    }
  }
  return null;
}

// ---- IBAN-Schutz (KEINE Restricted-Data-Kategorie) ----
//
// Die Ziffern einer IBAN in 4er-Gruppen enthalten oft ein Luhn-gueltiges Kartenfenster
// (gemessen: rund 5 % zufaelliger deutscher IBANs). Damit eine IBAN weder abgelehnt noch
// maskiert wird, blendet die Kartensuche gueltige IBANs aus. Geprueft wird die Laenge
// des Landes (ISO 13616) UND die Pruefsumme (mod 97 == 1) - ausgeblendet wird also nur
// eine echte IBAN, nie eine beliebige Buchstaben-Ziffern-Folge vor einer Karte.
const IBAN_COUNTRY_LENGTHS = Object.freeze({
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20,
  EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27,
  GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30,
  KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24,
  ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29,
  PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27,
  ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
});
// Laendercode + 2 Pruefziffern + alphanumerisch, dazwischen hoechstens EIN Leerzeichen.
const IBAN_CANDIDATE = /(?<![\p{L}\p{N}])[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}/gu;
const IBAN_COUNTRY_CODE_LENGTH = 2;
const IBAN_HEADER_LENGTH = 4; // Laendercode + Pruefziffern, wandert vor der Pruefung ans Ende
const IBAN_MOD97_BASE = 97n;
const IBAN_MOD97_VALID_REMAINDER = 1n;
const IBAN_LETTER_VALUE_OFFSET = 55; // "A" (65) -> 10 ... "Z" (90) -> 35
const CARD_SEARCH_BLANK = "#";

function ibanChecksumValid(compact) {
  const rearranged = compact.slice(IBAN_HEADER_LENGTH) + compact.slice(0, IBAN_HEADER_LENGTH);
  const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - IBAN_LETTER_VALUE_OFFSET));
  return BigInt(numeric) % IBAN_MOD97_BASE === IBAN_MOD97_VALID_REMAINDER;
}

// Laenge (inkl. Leerzeichen) der gueltigen IBAN am Anfang von raw, sonst 0. Genau EIN
// Pruefversuch je Kandidat - der mit der Registry-Laenge des Landes.
function validIbanLength(raw) {
  const expectedLength = IBAN_COUNTRY_LENGTHS[raw.slice(0, IBAN_COUNTRY_CODE_LENGTH).toUpperCase()];
  if (!expectedLength) return 0;
  let compactLength = 0;
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] !== " ") compactLength++;
    if (compactLength === expectedLength) {
      const compact = raw.slice(0, index + 1).replace(/ /g, "").toUpperCase();
      return ibanChecksumValid(compact) ? index + 1 : 0;
    }
  }
  return 0;
}

// Eigener exec()-Lauf statt matchAll: der Kandidat ist gierig (bis zu 30 Folgezeichen)
// und kann eine unmittelbar folgende zweite IBAN mitfassen. Nach einem Treffer geht es
// hinter dessen WAHREM Ende weiter, nach einem Fehlschlag ein Zeichen weiter.
function findIbanSpans(text) {
  const spans = [];
  const candidatePattern = new RegExp(IBAN_CANDIDATE.source, IBAN_CANDIDATE.flags);
  let match = candidatePattern.exec(text);
  while (match) {
    const length = validIbanLength(match[0]);
    if (length) spans.push({ start: match.index, end: match.index + length });
    candidatePattern.lastIndex = match.index + (length || 1);
    match = candidatePattern.exec(text);
  }
  return spans;
}

// Gleiche Laenge, gleiche Positionen - nur die IBAN-Zeichen sind durch ein Nicht-Ziffer-
// Zeichen ersetzt. Eine Karte DIREKT hinter einer IBAN bleibt so auffindbar.
function withoutIbans(text) {
  let blanked = text;
  for (const span of findIbanSpans(text)) {
    blanked = blanked.slice(0, span.start) + CARD_SEARCH_BLANK.repeat(span.end - span.start) + blanked.slice(span.end);
  }
  return blanked;
}

function findCardSpans(originalText) {
  const text = withoutIbans(originalText);
  const spans = [];
  for (const match of text.matchAll(CARD_CANDIDATE)) {
    const candidate = { raw: match[0], start: match.index, end: match.index + match[0].length };
    const minDigits = requiredCardDigits(text, candidate);
    const window = minDigits === null ? null : bestCardWindow(candidate.raw, minDigits);
    if (window) spans.push({ start: candidate.start + window.start, end: candidate.start + window.end });
  }
  return spans;
}

// ---- Beschriftete Werte (Behoerden-IDs und Zugangsdaten) ----

// Sucht "Label + Trenner + Wert" und liefert die Spanne des WERTS (das Label bleibt in
// der Ausgabe sichtbar, nur der Wert wird maskiert). acceptsValue entscheidet ueber den
// gefundenen Wert (Mindestziffern bzw. Secret-Form). Das "d"-Flag liefert die Position
// der Wert-Gruppe.
function findLabeledValueSpans(text, { pattern, acceptsValue }) {
  const spans = [];
  for (const match of text.matchAll(pattern)) {
    const [start, end] = match.indices[1];
    if (acceptsValue(match[1])) spans.push({ start, end });
  }
  return spans;
}

// ---- 2. Behoerdliche Kennnummern (nur beschriftet) ----

const GOVERNMENT_ID_MIN_DIGITS = 6;
const GOVERNMENT_ID_LABELS = Object.freeze([
  "ssn",
  "social security(?: number| no\\.?)?",
  "sozialversicherungs(?:nummer|-?nr\\.?)",
  "steuer-?id(?:entifikationsnummer)?",
  "(?:personal)?ausweis(?:nummer|-?nr\\.?)",
  "(?:reise)?pass(?:nummer|-?nr\\.?)",
  "passport(?: number| no\\.?)?",
  "num[ée]ro de s[ée]curit[ée] sociale",
  "nir",
  "num[ée]ro fiscal",
  "num[ée]ro de passeport",
]);
// Trenner zwischen Label und Wert: Doppelpunkt/Gleich/Raute ODER Leerzeichen, optional
// mit "is"/"ist"/"est" ("SSN 123-45-6789", "Steuer-ID: ...", "my SSN is ...").
const GOVERNMENT_ID_JOINER = "(?:\\s*[:=#]\\s*|\\s+(?:(?:is|ist|est)\\s+)?)";
// Wert: Gruppen aus Buchstaben/Ziffern, getrennt durch EIN Leerzeichen/Punkt/Bindestrich/
// Schraegstrich. Jede Gruppe enthaelt eine Ziffer - ausser einem einzelnen Buchstaben
// zwischen Zifferngruppen (deutsche Sozialversicherungsnummer "65 170839 J 003"). Ein
// Folgewort ohne Ziffer ("... und danke") beendet den Wert.
const ID_GROUP_WITH_DIGIT = "(?=[A-Za-z]*\\d)[A-Za-z\\d]+";
const ID_GROUP = `(?:${ID_GROUP_WITH_DIGIT}|[A-Za-z](?=[ ./-]\\d))`;
const GOVERNMENT_ID_MAX_EXTRA_GROUPS = 12;
const GOVERNMENT_ID_PATTERN = new RegExp(
  `${wordAlternationSource(GOVERNMENT_ID_LABELS)}${GOVERNMENT_ID_JOINER}` +
    `(${ID_GROUP_WITH_DIGIT}(?:[ ./-]${ID_GROUP}){0,${GOVERNMENT_ID_MAX_EXTRA_GROUPS}})`,
  "dgiu",
);

const GOVERNMENT_ID_RULE = Object.freeze({
  pattern: GOVERNMENT_ID_PATTERN,
  acceptsValue: (value) => digitCount(value) >= GOVERNMENT_ID_MIN_DIGITS,
});

// ---- 3. Zugangsdaten ----

// Privater Schluessel im PEM-Format (auch PGP "PRIVATE KEY BLOCK"): die Kopfzeile allein genuegt. Maskiert wird bis zur
// passenden END-Zeile oder, fehlt sie, bis zum Textende - ohne Laengengrenze. Gesucht wird
// mit zwei einfachen Mustern statt eines Musters mit Lazy-Quantifizierer: nach einem
// Block geht die Suche hinter dessen Ende weiter, jede Stelle wird hoechstens einmal
// gelesen (linear, auch bei vielen Kopfzeilen ohne END).
const PEM_PRIVATE_KEY_HEADER = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;
const PEM_PRIVATE_KEY_FOOTER = /-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;

function findPrivateKeyBlockSpans(text) {
  const spans = [];
  const header = new RegExp(PEM_PRIVATE_KEY_HEADER.source, "g");
  const footer = new RegExp(PEM_PRIVATE_KEY_FOOTER.source, "g");
  let match = header.exec(text);
  while (match) {
    footer.lastIndex = header.lastIndex;
    const end = footer.exec(text) ? footer.lastIndex : text.length;
    spans.push({ start: match.index, end });
    header.lastIndex = end;
    match = header.exec(text);
  }
  return spans;
}

// Secret-Token mit festem Anbieter-Praefix. Die Rumpflaenge ist nach oben OFFEN (echte
// Schluessel werden laenger: sk-proj-/sk-ant-Keys, JWT mit grosser Payload). Linear bleibt
// das, weil jedes Muster nur an einem Token-Anfang beginnt (TOKEN_START: davor kein
// Token-Zeichen) - je zusammenhaengendem Zeichenlauf gibt es hoechstens einen Versuch pro
// Muster, und die Rumpf-Klassen enthalten den Trenner "." des JWT nicht. Nach dem Treffer
// wird bis zum letzten Token-Zeichen verlaengert: maskiert wird immer das ganze Token.
const TOKEN_START = "(?<![A-Za-z0-9_-])";
const TOKEN_CHAR = /[A-Za-z0-9_-]/;
const TOKEN_PATTERNS = Object.freeze(
  [
    "(?:AKIA|ASIA)[0-9A-Z]{16}", // AWS Access Key ID
    "gh[pousr]_[A-Za-z0-9]{36,}", // GitHub Token (klassisch)
    "github_pat_[A-Za-z0-9_]{22,}", // GitHub Fine-grained Token
    "xox[abposr]-[A-Za-z0-9-]{10,}", // Slack Token
    "(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}", // Stripe API Key
    "AIza[0-9A-Za-z_-]{35,}", // Google API Key
    "sk-[A-Za-z0-9_-]{20,}", // sk-Keys (OpenAI inkl. sk-proj-, Anthropic sk-ant-)
    "eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}", // JWT
  ].map((source) => new RegExp(`${TOKEN_START}${source}`, "g")),
);

function tokenEnd(text, index) {
  let end = index;
  while (end < text.length && TOKEN_CHAR.test(text[end])) end++;
  return end;
}

function findTokenSpans(text) {
  return TOKEN_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({
      start: match.index,
      end: tokenEnd(text, match.index + match[0].length),
    })),
  );
}

const CREDENTIAL_LABELS = Object.freeze([
  "password",
  "passwort",
  "kennwort",
  "mot de passe",
  "pin(?:-?(?:code|nummer))?",
  "tan(?:-?nummer)?",
  "otp",
  "one[- ]time code",
  "einmal-?code",
]);
// Pflicht-Trenner: Doppelpunkt/Gleich ODER "is"/"ist"/"est" - "kein Passwort noetig"
// oder "Passwort vergessen" haben keinen Trenner und bleiben unerkannt.
const CREDENTIAL_JOINER = "(?:\\s*[:=]\\s*|\\s+(?:is|ist|est)\\s+)";
const CREDENTIAL_LABEL_PATTERN = new RegExp(
  `${wordAlternationSource(CREDENTIAL_LABELS)}${CREDENTIAL_JOINER}(\\S+)`,
  "dgiu",
);
const CREDENTIAL_VALUE_MIN_CHARS = 4;
const TRAILING_SENTENCE_PUNCTUATION = /[.,;:!?)]+$/u;

// Secret-Form: mindestens CREDENTIAL_VALUE_MIN_CHARS Zeichen UND mindestens ein Zeichen,
// das kein Buchstabe ist (Ziffer oder Sonderzeichen). Satzzeichen am Ende zaehlen nicht -
// sonst wuerde "Die PIN ist gesperrt." wegen des Punkts als Secret gelten. Maskiert wird
// trotzdem der ganze Wert (kein Rest eines Passworts bleibt sichtbar).
function hasSecretShape(value) {
  const core = value.replace(TRAILING_SENTENCE_PUNCTUATION, "");
  return core.length >= CREDENTIAL_VALUE_MIN_CHARS && /[^\p{L}]/u.test(core);
}

const CREDENTIAL_LABEL_RULE = Object.freeze({
  pattern: CREDENTIAL_LABEL_PATTERN,
  acceptsValue: hasSecretShape,
});

function findStructuredCredentialSpans(text) {
  return [...findPrivateKeyBlockSpans(text), ...findTokenSpans(text)];
}

// ---- Zusammenfuehrung ----

function byStart(left, right) {
  return left.start - right.start;
}

function withCategory(category) {
  return (span) => ({ category, ...span });
}

// Nimmt aus candidates nur Spannen auf, die weder eine bereits akzeptierte noch eine
// zuvor aufgenommene Spanne ueberlappen. accepted ist nach start sortiert und
// ueberlappungsfrei - deshalb reicht ein Zeiger, der mitlaeuft (linear nach dem
// Sortieren, auch bei sehr vielen Treffern in einem langen Text).
function addNonOverlapping(accepted, candidates) {
  const kept = [];
  let cursor = 0;
  for (const candidate of [...candidates].sort(byStart)) {
    while (cursor < accepted.length && accepted[cursor].end <= candidate.start) cursor++;
    const blockedByAccepted = cursor < accepted.length && accepted[cursor].start < candidate.end;
    const blockedByKept = kept.length > 0 && kept.at(-1).end > candidate.start;
    if (!blockedByAccepted && !blockedByKept) kept.push(candidate);
  }
  return [...accepted, ...kept].sort(byStart);
}

// Reihenfolge = Vorrang: Karte vor Behoerden-ID vor Zugangsdaten. Jede Stelle zaehlt
// genau einmal. Ergebnis nach start sortiert.
function collectHits(text) {
  const cards = findCardSpans(text).map(withCategory(RESTRICTED_CATEGORY.PAYMENT_CARD));
  const governmentIds = findLabeledValueSpans(text, GOVERNMENT_ID_RULE).map(
    withCategory(RESTRICTED_CATEGORY.GOVERNMENT_ID),
  );
  const credentials = [
    ...findStructuredCredentialSpans(text),
    ...findLabeledValueSpans(text, CREDENTIAL_LABEL_RULE),
  ].map(withCategory(RESTRICTED_CATEGORY.CREDENTIAL_SECRET));
  const withGovernmentIds = addNonOverlapping(addNonOverlapping([], cards), governmentIds);
  return addNonOverlapping(withGovernmentIds, credentials);
}

// ---- Oeffentliche API ----

// findRestrictedData(text) -> [{ category, start, end }], nach start sortiert.
// Nicht-String -> leere Liste (Aufrufer entscheiden ueber Nicht-Text-Felder selbst).
export function findRestrictedData(text) {
  if (typeof text !== "string" || !text) return [];
  return collectHits(text);
}

function maskCard(raw) {
  return "****" + raw.replace(/\D/g, "").slice(-CARD_LAST_DIGITS_SHOWN);
}

// Behoerden-ID und Zugangsdaten: vollstaendig ersetzt, kein Teilwert sichtbar (anders als
// bei der Karte gibt es keine unschaedliche Teilmenge, die angezeigt werden duerfte).
const MASK_FN = Object.freeze({
  [RESTRICTED_CATEGORY.PAYMENT_CARD]: maskCard,
  [RESTRICTED_CATEGORY.GOVERNMENT_ID]: () => "[restricted-government-id]",
  [RESTRICTED_CATEGORY.CREDENTIAL_SECRET]: () => "[restricted-credential]",
});

// maskRestrictedText(text) -> String. Nicht-String unveraendert zurueck (Aufrufer duerfen
// blind durchreichen). Rest des Textes byte-gleich.
export function maskRestrictedText(text) {
  const hits = findRestrictedData(text);
  if (!hits.length) return text;
  let out = "";
  let cursor = 0;
  for (const hit of hits) {
    out += text.slice(cursor, hit.start) + MASK_FN[hit.category](text.slice(hit.start, hit.end));
    cursor = hit.end;
  }
  return out + text.slice(cursor);
}

// firstRestrictedField(value, exemptKeys) -> { category, field } oder null. Laeuft
// rekursiv ueber Objekte/Arrays, prueft NUR Strings (Nicht-String-Felder wie Zahlen/Enums
// sind strukturell unkritisch). Fail-closed: ALLE Stringfelder werden geprueft, AUSSER
// den ausdruecklich ausgenommenen Top-Level-Schluesseln (exemptKeys) - ein kuenftiges
// Feld ist damit automatisch mitgedeckt, ohne diese Datei anzufassen.
// field = Schluesselpfad OHNE Werte (z.B. "context.key_facts"); ein Array-Index bleibt
// weg (die Fundstelle im Array ist fuer den Ablehnungstext irrelevant).
export function firstRestrictedField(value, exemptKeys) {
  return walkForRestrictedField(value, exemptKeys, { path: null, isTopLevel: true });
}

function restrictedFieldInString(value, path) {
  const hits = findRestrictedData(value);
  return hits.length ? { category: hits[0].category, field: path ?? "(root)" } : null;
}

function restrictedFieldInArray(value, exemptKeys, path) {
  for (const entry of value) {
    const found = walkForRestrictedField(entry, exemptKeys, { path, isTopLevel: false });
    if (found) return found;
  }
  return null;
}

function restrictedFieldInObject(value, exemptKeys, { path, isTopLevel }) {
  for (const [key, entry] of Object.entries(value)) {
    if (isTopLevel && exemptKeys.includes(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    const found = walkForRestrictedField(entry, exemptKeys, { path: childPath, isTopLevel: false });
    if (found) return found;
  }
  return null;
}

// Ein Objekt-Argument statt vier Positionsargumenten (max-params) - der Fall-Unterschied
// (String/Array/Objekt) sitzt je in einer eigenen kleinen Funktion oben.
function walkForRestrictedField(value, exemptKeys, location) {
  if (typeof value === "string") return restrictedFieldInString(value, location.path);
  if (Array.isArray(value)) return restrictedFieldInArray(value, exemptKeys, location.path);
  if (value != null && typeof value === "object") return restrictedFieldInObject(value, exemptKeys, location);
  return null;
}
