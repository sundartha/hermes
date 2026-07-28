// AL-P8: Treiber-Registry (Muster scenarios/index.mjs, G23) - EIN Ort statt verstreuter
// if/switch-Ketten. Ein Treiber ist eine Factory: create({scenario, provider}) ->
// transport (Port-Vertrag: siehe driver-texml.mjs/driver-shim.mjs Kopfkommentare).
import { TEXML_DRIVER_ID, createTexmlTransport } from "./driver-texml.mjs";
import { SHIM_DRIVER_ID, createShimTransport } from "./driver-shim.mjs";

export const DRIVERS = Object.freeze({
  [TEXML_DRIVER_ID]: { id: TEXML_DRIVER_ID, create: createTexmlTransport, requiresProvider: null },
  [SHIM_DRIVER_ID]: { id: SHIM_DRIVER_ID, create: createShimTransport, requiresProvider: "telnyx" },
});

export const DRIVER_IDS = Object.freeze(Object.keys(DRIVERS));

// O1: der Assistant-Pfad ist der live laufende - "der Bench misst den Pfad, der live
// ist" heisst per Default DIESEN Treiber, nicht den bequemeren TeXML-Bestand.
export const DEFAULT_DRIVER_ID = SHIM_DRIVER_ID;

// hold-warteschleife misst die serverseitige TeXML-No-Speech-Staffel (siehe Szenario-
// Kommentar dort) - ohne scenario.drivers laufen alle Szenarien auf beiden Treibern.
export function scenarioSupportsDriver(scenario, driverId) {
  return (scenario.drivers ?? DRIVER_IDS).includes(driverId);
}
