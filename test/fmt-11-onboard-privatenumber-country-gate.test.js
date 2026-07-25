// FMT-11 (i18n-Testkatalog, tasks/i18n-tests/10-zeit-format-daten.md:284) - Private
// Summary-Nummer: ein US-Land-Tenant bekommt beim Onboarding trotzdem nur das +49-Gate.
//
// SOLL (rot): POST /api/onboard mit country="US" UND privateNumber="+12025550123" (E.164,
// gueltiges US-Format) sollte NICHT an einem hart auf "+49" verdrahteten Laendergate
// scheitern - das Land des Requests passt zur Nummer. Beleg: src/routes/api-onboard.js:125
// ruft `normalizePrivateNumber(privateNumber)` OHNE 2. Argument (allowedCountryCodes) auf;
// der Default in src/store/defaults.js:541 ist `["+49"]`, unabhaengig von body.country.
//
// Eigene Datei (kein Edit an test/onboarding-route.test.js, Datei-Eigentum Block B6):
// gleiches Muster (startServer, postJson) wie dort (S1-9a/b).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("FMT-11 (SOLL rot): country=US + privateNumber=+1... darf NICHT am +49-Default-Gate scheitern", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, {
      tenantId: "t_fmt11",
      country: "US",
      privateNumber: "+12025550123",
    });
    const json = await res.json();
    // SOLL: passendes Land -> kein 400. Heute wirft normalizePrivateNumber ohne das
    // Land des Requests durchzureichen -> 400 trotz country=US (Zeile 125).
    assert.notEqual(
      res.status,
      400,
      `SOLL: country=US + passende +1-Nummer darf nicht am +49-Default-Gate scheitern (war ${res.status}, error=${json?.error})`,
    );
  } finally {
    await srv.stop();
  }
});
