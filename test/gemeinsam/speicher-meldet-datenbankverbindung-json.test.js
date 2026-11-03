import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const PROBE_FEHLT = "Probe fehlt an der Fassade";
const { config, speicher } = await jsonSpeicherImDatenordner("statusroute-json-");

test("json-Speicher: Verbindungsprobe gelingt ohne Datenbank", async () => {
  assert.equal(config.store.storeBackend === "pg", false);
  assert.equal(await speicher.pruefeVerbindung(), undefined);
});

test("[NIE2] json-Speicher: die Probe erfüllt sofort ohne Wert und braucht keine Datenbank", async () => {
  assert.equal(typeof speicher.pruefeVerbindung, "function", PROBE_FEHLT);
  const noch = Symbol("noch offen");
  const ergebnis = await Promise.race([speicher.pruefeVerbindung(), Promise.resolve(noch)]);
  assert.equal(ergebnis, undefined);
});

test("[NIE3] json-Speicher: poolZustand meldet weiter null", () => {
  assert.equal(speicher.poolZustand(), null);
});
