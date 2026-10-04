import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { E164_FORMAT_ERROR } from "../../src/telephony/outbound-gates.js";
import { seedCall, seedState, startServer, waitForLog } from "../helpers.js";
import { maskNumber } from "../../src/util.js";

const STORED_CALL_ID = "call_kundendaten";
const KUNDENDATEN_MARKER = "Kundengeheimnis-4711";
const PREMIUM_TARGET = "+4990012345678";
const sternImMuster = (text) => text.replace(/\*/g, "\\*");
const INJECTED_TARGETS = ["+4915112345678;id", "+49151$(id)", "+4915112345678\n+493011122"];
const CUSTOMER_DATA_PATHS = [
  "/api/state",
  `/api/calls/${STORED_CALL_ID}`,
  "/api/tenant-data/export",
];
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;

let hermes;

before(async () => {
  const storedCall = seedCall({
    id: STORED_CALL_ID,
    status: "completed",
    summary: KUNDENDATEN_MARKER,
  });
  hermes = await startServer({ seed: seedState({ calls: [storedCall] }) });
});

after(() => hermes.stop());

function placeCallTo(to) {
  return fetch(`${hermes.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Termin vereinbaren" }),
  });
}

test("SG-14 Wahlziel mit Sonderzeichen wird abgelehnt statt weitergereicht", async () => {
  for (const target of INJECTED_TARGETS) {
    const response = await placeCallTo(target);
    assert.equal(response.status, HTTP_BAD_REQUEST, JSON.stringify(target));
    assert.equal((await response.json()).error, E164_FORMAT_ERROR);
  }
  const dialled = hermes.readStore().calls.map((call) => call.to);
  assert.deepEqual(
    dialled.filter((to) => INJECTED_TARGETS.includes(to)),
    [],
  );
});

test("SG-16 Staging-Adresse ohne Anmeldung liefert keine Kundendaten", async () => {
  assert.ok(hermes.externalUrl, "der Test braucht eine Netzwerkadresse ausser localhost");
  const fromInside = await fetch(`${hermes.localUrl}/api/calls/${STORED_CALL_ID}`);
  assert.equal(fromInside.status, HTTP_OK);
  assert.match(await fromInside.text(), new RegExp(KUNDENDATEN_MARKER));
  for (const path of CUSTOMER_DATA_PATHS) {
    const fromOutside = await fetch(`${hermes.externalUrl}${path}`);
    assert.equal(fromOutside.status, HTTP_FORBIDDEN, path);
    assert.doesNotMatch(await fromOutside.text(), new RegExp(KUNDENDATEN_MARKER), path);
  }
});

test("SG-17 abgelehnter Anruf hinterlässt einen Audit-Eintrag", async () => {
  const response = await placeCallTo(PREMIUM_TARGET);
  assert.equal(response.status, HTTP_FORBIDDEN);
  const entry = new RegExp(
    `\\[audit\\] place_call_denied ip=\\S+ to=${sternImMuster(maskNumber(PREMIUM_TARGET))} grund=denylist`,
  );
  await waitForLog(hermes, entry);
  assert.equal(hermes.stdout.includes(PREMIUM_TARGET.slice(1)), false);
});
