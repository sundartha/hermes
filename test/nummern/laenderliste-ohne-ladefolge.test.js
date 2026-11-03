import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveNumberCountry,
  resolveOnboardCountry,
  tenantGeoForCountry,
} from "../../src/geo/resolve.js";

const KAUFBARE_LAENDER = ["US"];
const SPAETERE_LAENDERLISTE = ["US", "CA"];
const LAND_OHNE_EIGENE_SPRACHE = "XX";

const standardsprache = () => tenantGeoForCountry(LAND_OHNE_EIGENE_SPRACHE).defaultLanguage;

test("Kaufland: ein DE-Kunde bekommt eine US-Nummer, ein Land der Liste bleibt, und resolve.js laesst die Standardsprache englisch", () => {
  assert.deepEqual(
    {
      kauflandDe: resolveNumberCountry("DE", KAUFBARE_LAENDER),
      kauflandUs: resolveNumberCountry("US", KAUFBARE_LAENDER),
      kauflandCaMitSpaetererListe: resolveNumberCountry("CA", SPAETERE_LAENDERLISTE),
      kauflandFrMitSpaetererListe: resolveNumberCountry("FR", SPAETERE_LAENDERLISTE),
      kauflandOhneHerkunftMitSpaetererListe: resolveNumberCountry(null, SPAETERE_LAENDERLISTE),
      standardsprache: standardsprache(),
    },
    {
      kauflandDe: "US",
      kauflandUs: "US",
      kauflandCaMitSpaetererListe: "CA",
      kauflandFrMitSpaetererListe: "US",
      kauflandOhneHerkunftMitSpaetererListe: "US",
      standardsprache: "en",
    },
    "resolveNumberCountry liefert das Herkunftsland statt US",
  );
});

test("[NIE1] Nach dem Laden von resolve.js allein liefert jedes Herkunftsland das Kaufland US und die Standardsprache bleibt englisch", () => {
  const kauflandJeHerkunft = {
    DE: resolveNumberCountry("DE", KAUFBARE_LAENDER),
    FR: resolveNumberCountry("FR", KAUFBARE_LAENDER),
    CA: resolveNumberCountry("CA", KAUFBARE_LAENDER),
    unbekannt: resolveNumberCountry(null, KAUFBARE_LAENDER),
  };
  assert.deepEqual(
    kauflandJeHerkunft,
    { DE: "US", FR: "US", CA: "US", unbekannt: "US" },
    "Kaufland je Herkunftsland",
  );
  assert.equal(standardsprache(), "en", "Standardsprache nach dem Laden von resolve.js");
});

test("[NIE3] Der Anmeldeweg bestimmt das Herkunftsland weiter aus Kunde, Vorschlag und Rueckfall, nicht aus der Laenderliste", () => {
  assert.deepEqual(
    {
      kundeFr: resolveOnboardCountry({
        userCountry: "FR",
        proposedCountry: "DE",
        fallbackCountry: "DE",
      }),
      vorschlagCa: resolveOnboardCountry({ proposedCountry: "CA", fallbackCountry: "DE" }),
      rueckfallDe: resolveOnboardCountry({ fallbackCountry: "DE" }),
      geoDe: tenantGeoForCountry(resolveOnboardCountry({ fallbackCountry: "DE" })),
    },
    {
      kundeFr: "FR",
      vorschlagCa: "CA",
      rueckfallDe: "DE",
      geoDe: { country: "DE", defaultLanguage: "de", timezone: "Europe/Berlin" },
    },
    "Herkunftsland des Anmeldewegs",
  );
});
