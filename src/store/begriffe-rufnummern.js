export function normNum(rawNumber) {
  return typeof rawNumber === "string" ? rawNumber.replace(/[\s\-()]/g, "") : "";
}

export const E164 = /^\+[1-9]\d{6,14}$/;

const NANP_ISO_COUNTRIES = Object.freeze([
  "US", "CA", "AG", "AI", "AS", "BB", "BM", "BS", "DM", "DO", "GD", "GU", "JM", "KN",
  "KY", "LC", "MP", "MS", "PR", "SX", "TC", "TT", "VC", "VG", "VI",
]);

export function isNanpCountry(countryIso) {
  return typeof countryIso === "string" && NANP_ISO_COUNTRIES.includes(countryIso.toUpperCase());
}

const TRUNK_ZERO_COUNTRY_CODES = ["+49", "+33", "+44"];
const NATIONAL_TRUNK_PREFIX = "0";

const NANP_COUNTRY_CODE = "+1";
const NANP_INTERNATIONAL_PREFIX = "011";
const NANP_TRUNK_PREFIX = "1";
const NANP_NSN_DIGITS = 10;
const NANP_NATIONAL_DIGITS = NANP_NSN_DIGITS + NANP_TRUNK_PREFIX.length;

const NANP_NSN_PATTERN = /^[2-9]\d{2}[2-9]\d{6}$/;

const DIALING_HOME_COUNTRY_CODES = [...TRUNK_ZERO_COUNTRY_CODES, NANP_COUNTRY_CODE];

const NO_NATIONAL_ELEVEN_RANGE_COUNTRIES = ["+49", "+33"];

export function hasTrunkZeroAfterCountryCode(e164) {
  if (typeof e164 !== "string" || !e164) return false;
  return TRUNK_ZERO_COUNTRY_CODES.some((code) => e164.startsWith(code + NATIONAL_TRUNK_PREFIX));
}

export function homeCountryCode(candidateNumbers, tenantCountryIso = null) {
  for (const num of candidateNumbers) {
    if (typeof num !== "string") continue;
    const code = DIALING_HOME_COUNTRY_CODES.find((dialingCode) => num.startsWith(dialingCode));
    if (!code) continue;
    if (code === NANP_COUNTRY_CODE && !isNanpCountry(tenantCountryIso)) continue;
    return code;
  }
  return null;
}

const INTERNATIONAL_CALL_PREFIX = "00";

function normalizeNanpTarget(raw) {
  const num = normNum(raw);
  if (num.startsWith("+")) return num;
  if (num.startsWith(INTERNATIONAL_CALL_PREFIX))
    return "+" + num.slice(INTERNATIONAL_CALL_PREFIX.length);
  if (num.startsWith(NANP_INTERNATIONAL_PREFIX))
    return "+" + num.slice(NANP_INTERNATIONAL_PREFIX.length);
  if (!/^\d+$/.test(num)) return num;
  if (num.length === NANP_NATIONAL_DIGITS && num.startsWith(NANP_TRUNK_PREFIX)) {
    const nsn = num.slice(NANP_TRUNK_PREFIX.length);
    return NANP_NSN_PATTERN.test(nsn) ? "+" + num : num;
  }
  if (num.length === NANP_NSN_DIGITS)
    return NANP_NSN_PATTERN.test(num) ? NANP_COUNTRY_CODE + num : num;
  return num;
}

function normalizeTrunkZeroTarget(num, homeCountry) {
  if (num.startsWith(INTERNATIONAL_CALL_PREFIX))
    return "+" + num.slice(INTERNATIONAL_CALL_PREFIX.length);
  if (
    num.startsWith(NANP_INTERNATIONAL_PREFIX) &&
    NO_NATIONAL_ELEVEN_RANGE_COUNTRIES.includes(homeCountry)
  )
    return num;
  if (num.startsWith(NATIONAL_TRUNK_PREFIX) && homeCountry)
    return homeCountry + num.slice(NATIONAL_TRUNK_PREFIX.length);
  return num;
}

export function normalizeDialTarget(num, homeCountry) {
  if (typeof num !== "string") return "";
  if (homeCountry === NANP_COUNTRY_CODE) return normalizeNanpTarget(num);
  return normalizeTrunkZeroTarget(num, homeCountry);
}

const DEFAULT_PRIVATE_NUMBER_CODES = Object.freeze(["+49"]);

const CALLING_CODE_FOR_COUNTRY = Object.freeze({
  DE: "+49", AT: "+43", CH: "+41", FR: "+33", GB: "+44", IE: "+353",
});

export function allowedPrivateNumberCodes(countryIso) {
  const cc = String(countryIso || "").toUpperCase();
  if (isNanpCountry(cc)) return [NANP_COUNTRY_CODE];
  const code = CALLING_CODE_FOR_COUNTRY[cc];
  return code ? [code] : DEFAULT_PRIVATE_NUMBER_CODES;
}

const CALLING_CODES_LONGEST_FIRST = Object.freeze(
  Object.values(CALLING_CODE_FOR_COUNTRY).sort((codeA, codeB) => codeB.length - codeA.length),
);
const COUNTRY_FOR_CALLING_CODE = Object.freeze(
  Object.fromEntries(Object.entries(CALLING_CODE_FOR_COUNTRY).map(([iso, code]) => [code, iso])),
);

export function countryForE164(e164) {
  if (typeof e164 !== "string" || !E164.test(e164)) return null;
  const code = CALLING_CODES_LONGEST_FIRST.find((callingCode) => e164.startsWith(callingCode));
  return code ? COUNTRY_FOR_CALLING_CODE[code] : null;
}

export function countryAllowed(e164, allowedCodes = DEFAULT_PRIVATE_NUMBER_CODES) {
  if (typeof e164 !== "string" || !e164) return false;
  return allowedCodes.includes("*") || allowedCodes.some((prefix) => e164.startsWith(prefix));
}
