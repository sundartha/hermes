const DEFAULT_PHONE_NUMBER_TYPE = "local";

export const PURCHASABLE_COUNTRIES = Object.freeze(["US"]);

const COUNTRY_SEARCH_PARAMS = Object.freeze(
  Object.fromEntries(PURCHASABLE_COUNTRIES.map((country) => [country, {}])),
);

export function searchParamsForCountry(country, { telnyxConnectionId = "" }) {
  const key = String(country || "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  return {
    countryCode: entry ? key : PURCHASABLE_COUNTRIES[0],
    connectionId: entry?.connectionId || telnyxConnectionId,
    type: entry?.phoneNumberType || DEFAULT_PHONE_NUMBER_TYPE,
  };
}

export function holdAmountForCountry(country, defaultHoldCents) {
  const key = String(country || "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  if (!entry || entry.holdAmountCents === undefined) return defaultHoldCents;
  if (!Number.isInteger(entry.holdAmountCents)) {
    throw new Error(`holdAmountCents fuer ${key} muss Integer-Cents sein`);
  }
  return entry.holdAmountCents;
}
