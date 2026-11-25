import { config } from "../config.ts";
import { nullGeoLookup } from "./stub.ts";
import { makeMaxmindGeoLookup } from "./maxmind.ts";

export function geoLookupAdapter(): () => { country: string } | null {
  if (!config.provisioning.geoEnabled) return nullGeoLookup;
  return makeMaxmindGeoLookup();
}
