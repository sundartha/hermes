import assert from "node:assert/strict";
import { test } from "node:test";

import { makeInternStatusRoutes } from "../../src/routes/intern-status.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { bearer, konfiguration, SCHLUESSEL, STATUS_PATH, mitStatusroute } from "./statusroute-hilfe.mjs";

test("Statusroute meldet echt, wenn die Sprachkonfiguration keinen Anbieterblock fuer ausgehende Anrufe hat", async () => {
  const config = { ...konfiguration(), voice: {} };
  const speicher = { pruefeVerbindung: async () => undefined, letzterFlushGelungen: async () => true };
  const { ergebnis } = await mitStatusroute({ speicher, makeInternStatusRoutes }, { config }, async (basis) => {
    const antwort = await abrufMitFrist(`${basis}${STATUS_PATH}`, { headers: { authorization: bearer(SCHLUESSEL) } });
    return { status: antwort.status, wert: antwort.headers.get("x-hermes-anrufe") };
  });
  assert.equal(ergebnis.status, 200);
  assert.equal(ergebnis.wert, "echt");
});
