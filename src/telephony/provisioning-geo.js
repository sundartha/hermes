const DEFAULT_PHONE_NUMBER_TYPE = "local";

const COUNTRY_SEARCH_PARAMS = Object.freeze({
  AT: {},
  AU: {},
  CA: {},
  CH: {},
  ES: {},
  FR: {},
  GB: {},
  IE: {},
  IT: {},
  US: {},
});

export function searchParamsForCountry(country, { provisioningCountry, telnyxConnectionId = "" }) {
  const key = String(country || "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  return {
    countryCode: entry ? key : provisioningCountry,
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
