import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite, LOGIN_SUB } from "../abrechnung/server-mit-testdatenbank.js";

const HTTP_OK = 200;
const KAUFLAND = "US";
const PLATTFORMLAND = "DE";
const NUMMERN_OBERGRENZE = 100;
const ANMELDUNGEN = [
  { gesendet: "DE", herkunft: "DE", sprache: "de" },
  { gesendet: "FR", herkunft: "FR", sprache: "fr" },
  { gesendet: "CA", herkunft: "CA", sprache: undefined },
  { gesendet: undefined, herkunft: PLATTFORMLAND, sprache: "de" },
];
const SCHALTER_WERTE = ["", "US"];

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "" });
const { config } = await import("../../src/config.js");
const store = await import("../../src/store.js");

let betreiberSitzung = null;

function betreiberAnmelden(hermes) {
  betreiberSitzung ??= hermes.anmelden().then(async ({ sessionCookie }) => {
    await hermes.db.query(
      "UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)",
      [LOGIN_SUB],
    );
    return sessionCookie;
  });
  return betreiberSitzung;
}

for (const { gesendet, herkunft, sprache } of ANMELDUNGEN) {
  for (const schalter of SCHALTER_WERTE) {
    test(`Onboard: country ${gesendet ?? "(fehlt)"} und FORCE_NUMBER_COUNTRY "${schalter}" legt Nummer mit Land US an, Antwort bleibt am Herkunftsland`, async () => {
      const hermes = laufendesHermes();
      Object.assign(config.provisioning, {
        provisioningEnabled: false,
        geoEnabled: false,
        maxNumbers: NUMMERN_OBERGRENZE,
        maxNumbersPerTenant: NUMMERN_OBERGRENZE,
        provisioningCountry: PLATTFORMLAND,
      });
      const sessionCookie = await betreiberAnmelden(hermes);
      const tenantId = `t_onboard_${gesendet ?? "ohne"}_${schalter || "leer"}`;

      const antwort = await hermes.anfrage("/api/onboard", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({ tenantId, country: gesendet }),
      });

      assert.equal(antwort.status, HTTP_OK);
      const koerper = await antwort.json();
      assert.equal(koerper.country, herkunft);
      if (sprache) assert.equal(koerper.language, sprache);
      const nummer = store.load().numbers.find((eintrag) => eintrag.id === koerper.numberId);
      assert.equal(nummer.country, KAUFLAND);
      assert.equal(nummer.language, koerper.language);
    });
  }
}
