import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const karte = JSON.parse(readFileSync(new URL("../../tools/bausteine.json", import.meta.url), "utf8"));

test("selbstbedienung-importrichtung: anrufe importiert nichts mehr aus selbstbedienung, der Bestand führt das Paar nicht mehr", () => {
  const paar = karte.altlast.find((eintrag) => eintrag.von === "anrufe" && eintrag.nach === "selbstbedienung");
  assert.equal(paar, undefined);
});

test("selbstbedienung-importrichtung: die Zeitzone je Land liegt in begriffe und gilt unverändert", async () => {
  const { TIMEZONE_FOR_COUNTRY } = await import("../../src/begriffe/sprache-zeit.js");
  assert.deepEqual(
    { ...TIMEZONE_FOR_COUNTRY },
    {
      DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich",
      FR: "Europe/Paris", GB: "Europe/London", IE: "Europe/Dublin",
      US: "America/New_York", CA: "America/Toronto",
    },
  );
  assert.equal(Object.isFrozen(TIMEZONE_FOR_COUNTRY), true);
});

test("selbstbedienung-importrichtung: geo/resolve nutzt dieselbe Tabelle", async () => {
  const { TIMEZONE_FOR_COUNTRY } = await import("../../src/begriffe/sprache-zeit.js");
  const { timezoneForCountry } = await import("../../src/geo/resolve.ts");
  for (const [land, zone] of Object.entries(TIMEZONE_FOR_COUNTRY)) assert.equal(timezoneForCountry(land), zone);
  assert.equal(timezoneForCountry("JP"), "Europe/Berlin");
});

test("selbstbedienung-importrichtung: die Newsletter-Links liegen in begriffe und tragen den Token", async () => {
  const { newsletterConfirmUrl, newsletterUnsubscribeUrl } = await import("../../src/begriffe/newsletter-links.ts");
  assert.equal(newsletterUnsubscribeUrl("https://x.example", "tok"), "https://x.example/newsletter/unsubscribe?token=tok");
  assert.equal(newsletterConfirmUrl("https://x.example", "tok"), "https://x.example/newsletter/confirm?token=tok");
});
