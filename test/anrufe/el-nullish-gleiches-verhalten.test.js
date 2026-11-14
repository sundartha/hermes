import assert from "node:assert/strict";
import test from "node:test";

import { tenantGeoForCountry } from "../../src/geo/resolve.js";
import { callLocaleFor } from "../../src/elevenlabs/call-locale.js";
import { calleeTimezone } from "../../src/elevenlabs/time-context.js";

const TENANT = "tenant-nullish";
const STATE_FR = Object.freeze({
  tenants: [{ id: TENANT, ...tenantGeoForCountry("FR") }],
  settings: {},
});

const OPTIONEN = { tenantId: TENANT, numberRecord: null, ownerName: "Owen Barrett", defaultVoiceId: "v" };

const OFFENLEGUNGSSPRACHE = [
  { name: "Angerufener in Deutschland", to: "+4915123456789", erwartet: "de" },
  { name: "Angerufener in Frankreich", to: "+33612345678", erwartet: "fr" },
  { name: "Angerufener in Grossbritannien", to: "+447911123456", erwartet: "en" },
  { name: "Land ohne eigene Sprache faellt auf den Auftraggeber (FR)", to: "+819012345678", erwartet: "fr" },
  { name: "+1 ohne Sprachtabelle faellt auf den Auftraggeber (FR)", to: "+15125550143", erwartet: "fr" },
  { name: "keine Nummer faellt auf den Auftraggeber (FR)", to: null, erwartet: "fr" },
  { name: "unbrauchbare Nummer faellt auf den Auftraggeber (FR)", to: "keine", erwartet: "fr" },
];

test("Offenlegungssprache: Sprache des Angerufenen, sonst die des Auftraggebers", () => {
  for (const fall of OFFENLEGUNGSSPRACHE)
    assert.equal(
      callLocaleFor(STATE_FR, { ...OPTIONEN, to: fall.to }).disclosureLanguage,
      fall.erwartet,
      fall.name,
    );
});

test("Gespraechssprache: angegebene Sprache vor Auftraggeber, leere Angabe zaehlt als fehlend", () => {
  assert.equal(callLocaleFor(STATE_FR, { ...OPTIONEN, to: null, callLanguage: "de" }).language, "de");
  assert.equal(callLocaleFor(STATE_FR, { ...OPTIONEN, to: null, callLanguage: "" }).language, "fr");
  assert.equal(callLocaleFor(STATE_FR, { ...OPTIONEN, to: null, callLanguage: null }).language, "fr");
});

test("Zone des Angerufenen: Land mit Zone, Land ohne Zone, ohne Land", () => {
  assert.equal(calleeTimezone("+4915123456789"), "Europe/Berlin");
  assert.equal(calleeTimezone("+447911123456"), "Europe/London");
  assert.equal(calleeTimezone("+819012345678"), "");
  assert.equal(calleeTimezone(null), "");
});
