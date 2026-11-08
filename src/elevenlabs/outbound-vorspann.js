import { eroeffnungFuerAnruf } from "./outbound.js";
import { erzeugeVorspann } from "./vorspann-erzeugen.js";

export function makeVorspannErzeuger({ config, store, synthese }) {
  return (call) => erzeugeVorspann({ eroeffnung: eroeffnungFuerAnruf({ store, config, call }), synthese });
}
