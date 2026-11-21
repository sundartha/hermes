import { config } from "../config.js";
import { providerMicroCentsToBucketCents } from "../billing/cost-calibration.ts";
import { kauflandFuer } from "../store.js";
import { z } from "zod";

const kauflandVon = kauflandFuer;

const GEO_KONFIG = z.object({
  telephony: z.object({ telnyxConnectionId: z.string() }),
  billing: z.object({ providerCurrency: z.string(), providerToBucketRateMicro: z.number() }),
});

function geoKonfig(): z.infer<typeof GEO_KONFIG> {
  return GEO_KONFIG.parse(config);
}

const DEFAULT_PHONE_NUMBER_TYPE = "local";

interface CountrySearchEntry {
  connectionId?: string;
  phoneNumberType?: string;
  holdAmountCents?: number;
}

export interface ProviderPrice {
  currency: string;
  upfrontMicroCents?: number;
  monthlyMicroCents?: number;
}

const COUNTRY_SEARCH_PARAMS: Readonly<Record<string, CountrySearchEntry>> = Object.freeze({
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

export function searchParamsForCountry(
  country: string | null | undefined,
): { countryCode: string | undefined; connectionId: string; type: string } {
  const countryCode = kauflandVon(country);
  const entry = COUNTRY_SEARCH_PARAMS[countryCode ?? ""];
  return {
    countryCode,
    connectionId: entry?.connectionId ?? geoKonfig().telephony.telnyxConnectionId,
    type: entry?.phoneNumberType ?? DEFAULT_PHONE_NUMBER_TYPE,
  };
}

export function holdAmountForCountry(country: string | null | undefined, defaultHoldCents: number): number {
  const key = (country ?? "").toUpperCase();
  const entry = COUNTRY_SEARCH_PARAMS[key];
  if (entry?.holdAmountCents === undefined) return defaultHoldCents;
  if (!Number.isInteger(entry.holdAmountCents)) {
    throw new Error(`holdAmountCents fuer ${key} muss Integer-Cents sein`);
  }
  return entry.holdAmountCents;
}

function bucketCentsFromProviderPrice(price: ProviderPrice | null | undefined, providerMicroCents: number | undefined): number | null {
  if (!price) return null;
  if (price.currency !== geoKonfig().billing.providerCurrency) return null;
  if (providerMicroCents === undefined || !Number.isInteger(providerMicroCents)) return null;
  return providerMicroCentsToBucketCents(
    providerMicroCents,
    geoKonfig().billing.providerToBucketRateMicro,
  );
}

export function holdAmountForProviderPrice(price: ProviderPrice | null | undefined, defaultHoldCents: number): number {
  const cents = bucketCentsFromProviderPrice(price, price?.upfrontMicroCents);
  return cents !== null && cents > 0 ? cents : defaultHoldCents;
}

export function monthlyCostCentsForProviderPrice(price: ProviderPrice | null | undefined): number | null {
  return bucketCentsFromProviderPrice(price, price?.monthlyMicroCents);
}
