export const EMERGENCY_SHORT_CODES = ["110", "112", "911", "999"];
const PREMIUM_PREFIXES = [
  "+870",
  "+881",
  "+882",
  "+883",
  "+979",
  "+878",
  "+49900",
  "+490900",
  "+49137",
  "+49180",
  "+49118",
  "+49700",
  "+44118",
  "+4470",
  "+449",
  "+44843",
  "+44844",
  "+44845",
  "+44870",
  "+44871",
  "+33118",
  "+33899",
  "+33892",
  "+33810",
  "+33820",
  "+1900",
  "+1976",
];

const HIGH_COST_COUNTRY_PREFIXES = [
  "+1809", "+1829", "+1849",
  "+1876",
  "+1268", "+1284", "+1473", "+1649", "+1664", "+1767",
  "+53",
  "+509",
  "+232",
  "+236",
  "+239",
  "+240",
  "+247",
  "+252",
  "+290",
  "+291",
  "+246",
  "+670",
  "+850",
  "+672",
  "+674",
  "+675",
  "+677",
  "+678",
  "+681",
  "+682",
  "+683",
  "+686",
  "+688",
  "+690",
];

export const DENIED_PREFIXES = [...PREMIUM_PREFIXES, ...HIGH_COST_COUNTRY_PREFIXES];

export function deniedPrefix(to) {
  if (EMERGENCY_SHORT_CODES.includes(to)) return to;
  return DENIED_PREFIXES.find((p) => to.startsWith(p)) ?? null;
}
export const isDenied = (to) => deniedPrefix(to) !== null;
