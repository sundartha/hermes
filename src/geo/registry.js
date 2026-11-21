import { config } from "../config.ts";
import { nullGeoLookup } from "./stub.js";
import { makeMaxmindGeoLookup } from "./maxmind.js";

export function geoLookupAdapter() {
  if (!config.provisioning.geoEnabled) return nullGeoLookup;
  return makeMaxmindGeoLookup(config.provisioning.geoDbPath);
}
