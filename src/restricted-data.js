export const RESTRICTED_CATEGORY = Object.freeze({
  PAYMENT_CARD: "payment_card",
  GOVERNMENT_ID: "government_id",
  CREDENTIAL_SECRET: "credential_secret",
});

const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";

function wordAlternationSource(sources) {
  return `${WORD_START}(?:${sources.join("|")})${WORD_END}`;
}

function digitCount(raw) {
  return raw.replace(/\D/g, "").length;
}

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
const CONTEXT_WINDOW_CHARS = 32;
const CARD_MIN_DIGITS_WITHOUT_CARD_WORD = 15;

const CARD_CANDIDATE = /(?<![+\d])\d(?:(?:[ -]|[.,] ?)?\d){11,18}(?!\d)/g;

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
const PHONE_MAX_DIGITS = 15;

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

const CARD_CONTEXT_STEMS = Object.freeze(["card", "carte", "karte"]);

function isExemptByContext(candidate, before) {
  if (/\D/.test(candidate.raw)) return false;
  const isPhone = PHONE_CONTEXT_PATTERN.test(before) && candidate.raw.length <= PHONE_MAX_DIGITS;
  const isReference = REFERENCE_CONTEXT_PATTERN.test(before) && !hasCardBrandPrefix(candidate.raw);
  return isPhone || isReference;
}

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

function hasCardGroupShape(raw) {
  const groups = raw.split(/\D+/);
  if (groups.length === 1) return true;
  if (groupSizesMatch(groups, AMEX_GROUP_SIZES) || groupSizesMatch(groups, DINERS_GROUP_SIZES)) return true;
  const lastGroupLength = groups.at(-1).length;
  const leadingGroupsFull = groups.slice(0, -1).every((group) => group.length === CARD_GROUP_SIZE);
  return leadingGroupsFull && lastGroupLength <= CARD_GROUP_SIZE;
}

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
const IBAN_CANDIDATE = /(?<![\p{L}\p{N}])[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}/gu;
const IBAN_COUNTRY_CODE_LENGTH = 2;
const IBAN_HEADER_LENGTH = 4;
const IBAN_MOD97_BASE = 97n;
const IBAN_MOD97_VALID_REMAINDER = 1n;
const IBAN_LETTER_VALUE_OFFSET = 55;
const CARD_SEARCH_BLANK = "#";

function ibanChecksumValid(compact) {
  const rearranged = compact.slice(IBAN_HEADER_LENGTH) + compact.slice(0, IBAN_HEADER_LENGTH);
  const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - IBAN_LETTER_VALUE_OFFSET));
  return BigInt(numeric) % IBAN_MOD97_BASE === IBAN_MOD97_VALID_REMAINDER;
}

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

function findLabeledValueSpans(text, { pattern, acceptsValue }) {
  const spans = [];
  for (const match of text.matchAll(pattern)) {
    const [start, end] = match.indices[1];
    if (acceptsValue(match[1])) spans.push({ start, end });
  }
  return spans;
}

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
const GOVERNMENT_ID_JOINER = "(?:\\s*[:=#]\\s*|\\s+(?:(?:is|ist|est)\\s+)?)";
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

const TOKEN_START = "(?<![A-Za-z0-9_-])";
const TOKEN_CHAR = /[A-Za-z0-9_-]/;
const TOKEN_PATTERNS = Object.freeze(
  [
    "(?:AKIA|ASIA)[0-9A-Z]{16}",
    "gh[pousr]_[A-Za-z0-9]{36,}",
    "github_pat_[A-Za-z0-9_]{22,}",
    "xox[abposr]-[A-Za-z0-9-]{10,}",
    "(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
    "AIza[0-9A-Za-z_-]{35,}",
    "sk-[A-Za-z0-9_-]{20,}",
    "eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}",
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
const CREDENTIAL_JOINER = "(?:\\s*[:=]\\s*|\\s+(?:is|ist|est)\\s+)";
const CREDENTIAL_LABEL_PATTERN = new RegExp(
  `${wordAlternationSource(CREDENTIAL_LABELS)}${CREDENTIAL_JOINER}(\\S+)`,
  "dgiu",
);
const CREDENTIAL_VALUE_MIN_CHARS = 4;
const TRAILING_SENTENCE_PUNCTUATION = /[.,;:!?)]+$/u;

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

function byStart(left, right) {
  return left.start - right.start;
}

function withCategory(category) {
  return (span) => ({ category, ...span });
}

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

export function findRestrictedData(text) {
  if (typeof text !== "string" || !text) return [];
  return collectHits(text);
}

function maskCard(raw) {
  return "****" + raw.replace(/\D/g, "").slice(-CARD_LAST_DIGITS_SHOWN);
}

const MASK_FN = Object.freeze({
  [RESTRICTED_CATEGORY.PAYMENT_CARD]: maskCard,
  [RESTRICTED_CATEGORY.GOVERNMENT_ID]: () => "[restricted-government-id]",
  [RESTRICTED_CATEGORY.CREDENTIAL_SECRET]: () => "[restricted-credential]",
});

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

function walkForRestrictedField(value, exemptKeys, location) {
  if (typeof value === "string") return restrictedFieldInString(value, location.path);
  if (Array.isArray(value)) return restrictedFieldInArray(value, exemptKeys, location.path);
  if (value != null && typeof value === "object") return restrictedFieldInObject(value, exemptKeys, location);
  return null;
}
