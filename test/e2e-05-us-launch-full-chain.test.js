// E2E-05 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:966) - US-Launch-
// Vollkette unter Produktionswerten.
//
// Faehrt die AUSGELIEFERTE Konfiguration (GAP-33, test/prod-env.js, bereits gemergt) -
// NICHT die neutralisierte BASE_ENV: sonst misst dieser Test genau den Zustand, gegen den
// GAP-33 gebaut wurde, und jedes gruene Ergebnis waere wertlos (Vorgabe des Workflows).
//
// SOLL (rot ab Schritt 1): der Katalog verlangt alle sechs Schritte (Onboard, Abo+DID,
// Inbound, Outbound, Summary-SMS, MCP get_agent_status) englisch/US-korrekt. Zwei
// eigenstaendige Wurzeln blockieren bereits Schritt 1 (Beleg tasks/i18n-tests/11-luecken-
// und-e2e.md:981-984):
//   (a) normalizePrivateNumber() im Onboard-Pfad ignoriert country=US komplett und
//       erbt den ["+49"]-Default (FMT-11, src/routes/api-onboard.js:125) -> 400, BEVOR
//       das Land ueberhaupt gelesen wird.
//   (b) selbst OHNE die private Nummer bleibt language="de" (D1/DID-01,
//       src/i18n/locales.js:268-280: "US" fehlt in LANGUAGE_FOR_COUNTRY).
// Die restlichen vier Schritte (DID-Kauf, Inbound, Outbound, SMS, MCP) sind nachgelagert
// zu (a)/(b) und werden hier NICHT zusaetzlich durchgespielt: ein spawnbasierter Versuch,
// unter prodEnv() weiter bis zur Reserve-/Cap-Kollision (Schritt 4) vorzudringen, traf in
// der Recherche bereits denselben, von GAP-33 bereits gepinnten Auslands-Reserve-Befund
// (test/prod-config-smoke.test.js "Outbound ins Ausland..." ist unter den heutigen
// Live-Werten ebenfalls rot) - dieselbe Wurzel doppelt zu belegen bringt keinen
// zusaetzlichen Launch-Gate-Erkenntnisgewinn gegenueber den beiden hier gemessenen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { prodEnv } from "./prod-env.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("E2E-05 Schritt 1a (SOLL rot): Onboard country=US + passende US-Privatnummer darf nicht am +49-Gate scheitern", async () => {
  const srv = await startServer({ env: prodEnv() });
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, {
      tenantId: "t_e2e05a",
      country: "US",
      privateNumber: "+14155550123",
    });
    const json = await res.json();
    assert.equal(
      res.status,
      200,
      `SOLL: Schritt 1 des US-Launches muss unter Produktionswerten gelingen ` +
        `(gemessen: HTTP ${res.status}, error=${json?.error})`,
    );
  } finally {
    await srv.stop();
  }
});

test("E2E-05 Schritt 1b (SOLL rot): Onboard country=US liefert language=en, nicht das de-Fallback", async () => {
  const srv = await startServer({ env: prodEnv() });
  try {
    // Ohne privateNumber, um den unabhaengigen Befund aus 1a nicht doppelt zu treffen -
    // dieser Test misst NUR die Sprachaufloesung (D1/DID-01).
    const res = await postJson(`${srv.localUrl}/api/onboard`, {
      tenantId: "t_e2e05b",
      country: "US",
    });
    assert.equal(res.status, 200, "Onboard ohne privateNumber muss unter Produktionswerten durchlaufen");
    const json = await res.json();
    assert.equal(
      json.language,
      "en",
      `SOLL: ein US-Onboard muss language=en liefern (gemessen: "${json.language}")`,
    );
  } finally {
    await srv.stop();
  }
});
