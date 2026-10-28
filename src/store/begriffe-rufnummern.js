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
