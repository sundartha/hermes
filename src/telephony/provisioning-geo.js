import { config } from "../config.js";
import { providerMicroCentsToBucketCents } from "../billing/cost-calibration.ts";
import { kauflandFuer } from "../store.js";
import { z } from "zod";

const kauflandVon = kauflandFuer;

const GEO_KONFIG = z.object({
  telephony: z.object({ telnyxConnectionId: z.string() }),
  billing: z.object({ providerCurrency: z.string(), providerToBucketRateMicro: z.number() }),
});

function geoKonfig() {
  return GEO_KONFIG.parse(config);
}

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
  const countryCode = kauflandVon(country);
  const entry = COUNTRY_SEARCH_PARAMS[countryCode ?? ""];
  return {
    countryCode,
    connectionId: entry?.connectionId ?? geoKonfig().telephony.telnyxConnectionId,
    type: entry?.phoneNumberType ?? DEFAULT_PHONE_NUMBER_TYPE,
  };
}

export function holdAmountForCountry(country, defaultHoldCents) {
  const key = (country ?? "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  if (entry?.holdAmountCents === undefined) return defaultHoldCents;
  if (!Number.isInteger(entry.holdAmountCents)) {
    throw new Error(`holdAmountCents fuer ${key} muss Integer-Cents sein`);
  }
  return entry.holdAmountCents;
}

function bucketCentsFromProviderPrice(price, providerMicroCents) {
  if (!price) return null;
  if (price.currency !== geoKonfig().billing.providerCurrency) return null;
  if (providerMicroCents === undefined || !Number.isInteger(providerMicroCents)) return null;
  return providerMicroCentsToBucketCents(
    providerMicroCents,
    geoKonfig().billing.providerToBucketRateMicro,
  );
}

export function holdAmountForProviderPrice(price, defaultHoldCents) {
  const cents = bucketCentsFromProviderPrice(price, price?.upfrontMicroCents);
  return cents !== null && cents > 0 ? cents : defaultHoldCents;
}

export function monthlyCostCentsForProviderPrice(price) {
  return bucketCentsFromProviderPrice(price, price?.monthlyMicroCents);
}
