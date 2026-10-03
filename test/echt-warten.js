import { setTimeout as warten } from "node:timers/promises";

import { testkostenZaehler } from "./testkosten.js";

const zaehler = testkostenZaehler("echtWarten");

export function echtWarten(ms) {
  zaehler.zaehle(ms);
  return warten(ms);
}
