import assert from "node:assert/strict";
import test from "node:test";

import { timezoneForCountry } from "../src/geo/resolve.js";
import { calleeTimezone, callTimeContext, todayIn } from "../src/elevenlabs/time-context.js";
import { DEFAULT_TIMEZONE } from "../src/store/defaults.js";

const NANP_NUMBER = "+15125550143";
const FR_NUMBER = "+33612345678";
const FR_TIMEZONE = "Europe/Paris";
const OWNER_TZ = "Asia/Tokyo";
const KEINE_ZONE = "";

test("Zone des Angerufenen: ableitbares Land -> seine Zone", () => {
  assert.equal(calleeTimezone(FR_NUMBER), FR_TIMEZONE);
});

test("Zone des Angerufenen: +1 liefert KEINEN Wert - nie geraten, nie DEFAULT_TIMEZONE (E2)", () => {
  assert.equal(
    timezoneForCountry(null),
    DEFAULT_TIMEZONE,
    "Vorbedingung: die Anzeige-Kette faellt auf den Default zurueck - sonst misst dieser Fall nichts",
  );
  assert.equal(
    calleeTimezone(NANP_NUMBER),
    KEINE_ZONE,
    "fuer eine +1-Nummer darf KEINE Zone entstehen - eine falsche ist schlimmer als keine",
  );
});

test("Zone des Angerufenen: fehlende oder unbrauchbare Nummer liefert ebenfalls nichts", () => {
  for (const eingabe of [null, undefined, "", "keine-nummer", "015123456"])
    assert.equal(calleeTimezone(eingabe), KEINE_ZONE, `Eingabe ${JSON.stringify(eingabe)}`);
});

test("heutiges Datum: ausgeschriebener Monat mit Wochentag, in der uebergebenen Zone", () => {
  const erwartet = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: OWNER_TZ,
  }).format(new Date());
  assert.equal(todayIn(OWNER_TZ), erwartet);
});

test("Zeitkontext: Auftraggeber-Zone fail-safe, Angerufenen-Zone ohne Rueckfall", () => {
  const kontext = callTimeContext({ tenantTimezone: OWNER_TZ, callee: FR_NUMBER });
  assert.equal(kontext.ownerZone, OWNER_TZ);
  assert.equal(kontext.calleeZone, FR_TIMEZONE);
  assert.equal(kontext.today, todayIn(OWNER_TZ));

  const ohne = callTimeContext({ tenantTimezone: "Nicht/EineZone", callee: NANP_NUMBER });
  assert.equal(ohne.ownerZone, DEFAULT_TIMEZONE);
  assert.equal(ohne.calleeZone, KEINE_ZONE);
});
