import { TEXML_DRIVER_ID, createTexmlTransport } from "./driver-texml.mjs";

export const DRIVERS = Object.freeze({
  [TEXML_DRIVER_ID]: { id: TEXML_DRIVER_ID, create: createTexmlTransport, requiresProvider: null },
});

export const DRIVER_IDS = Object.freeze(Object.keys(DRIVERS));

export const DEFAULT_DRIVER_ID = TEXML_DRIVER_ID;

export function scenarioSupportsDriver(scenario, driverId) {
  return (scenario.drivers ?? DRIVER_IDS).includes(driverId);
}
