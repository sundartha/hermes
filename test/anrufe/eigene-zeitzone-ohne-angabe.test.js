import { test } from "node:test";
import assert from "node:assert/strict";
import { callTimeContext } from "../../src/elevenlabs/time-context.js";

const FRANZOESISCHE_NUMMER = "+33142684000";
const STANDARD_ZONE = "Europe/Berlin";

const zoneDesBesitzers = (tenantTimezone) =>
  callTimeContext({ tenantTimezone, callee: FRANZOESISCHE_NUMMER }).ownerZone;

test("ohne Zeitzone des Besitzers rechnet der Gesprächskontext in Berliner Zeit", () => {
  assert.equal(zoneDesBesitzers(undefined), STANDARD_ZONE);
});

test("eine Zeitzone null des Besitzers fällt auf Berliner Zeit zurück", () => {
  assert.equal(zoneDesBesitzers(null), STANDARD_ZONE);
});

test("eine Zahl als Zeitzone des Besitzers fällt auf Berliner Zeit zurück", () => {
  assert.equal(zoneDesBesitzers(123), STANDARD_ZONE);
});

test("ein leerer Text als Zeitzone des Besitzers fällt auf Berliner Zeit zurück", () => {
  assert.equal(zoneDesBesitzers(""), STANDARD_ZONE);
});

test("eine gültige Zeitzone des Besitzers bleibt im Gesprächskontext erhalten", () => {
  assert.equal(zoneDesBesitzers("America/New_York"), "America/New_York");
});
