// AL-P8: Treiber-Registry (Muster scenarios/index.mjs, G23) - EIN Ort statt verstreuter
// if/switch-Ketten. Ein Treiber ist eine Factory: create({scenario, provider}) ->
// transport (Port-Vertrag: siehe driver-texml.mjs Kopfkommentar).
import { TEXML_DRIVER_ID, createTexmlTransport } from "./driver-texml.mjs";

export const DRIVERS = Object.freeze({
  [TEXML_DRIVER_ID]: { id: TEXML_DRIVER_ID, create: createTexmlTransport, requiresProvider: null },
});

export const DRIVER_IDS = Object.freeze(Object.keys(DRIVERS));

// IE6-S1: seit dem Assistant-Pfad ist TeXML der einzige Treiber.
export const DEFAULT_DRIVER_ID = TEXML_DRIVER_ID;

// hold-warteschleife misst die serverseitige TeXML-No-Speech-Staffel (siehe Szenario-
// Kommentar dort) - ohne scenario.drivers laufen alle Szenarien auf beiden Treibern.
export function scenarioSupportsDriver(scenario, driverId) {
  return (scenario.drivers ?? DRIVER_IDS).includes(driverId);
}
