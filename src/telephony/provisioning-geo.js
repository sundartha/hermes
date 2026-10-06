import { config } from "../config.js";
import { providerMicroCentsToBucketCents } from "../billing/cost-calibration.js";

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

export function searchParamsForCountry(country) {
  const key = String(country || "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  return {
    countryCode: entry ? key : config.provisioning.provisioningCountry,
    connectionId: entry?.connectionId || config.telephony.telnyxConnectionId,
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

function bucketCentsFromProviderPrice(price, providerMicroCents) {
  if (!price) return null;
  if (price.currency !== config.billing.providerCurrency) return null;
  if (!Number.isInteger(providerMicroCents)) return null;
  return providerMicroCentsToBucketCents(providerMicroCents, config.billing.providerToBucketRateMicro);
}

export function holdAmountForProviderPrice(price, defaultHoldCents) {
  const cents = bucketCentsFromProviderPrice(price, price?.upfrontMicroCents);
  return cents !== null && cents > 0 ? cents : defaultHoldCents;
}

export function monthlyCostCentsForProviderPrice(price) {
  return bucketCentsFromProviderPrice(price, price?.monthlyMicroCents);
}
