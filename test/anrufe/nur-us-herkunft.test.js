import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState, startServer, waitForLog } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HEIMATZIEL = "+4915112345678";
const AUFTRAG = "Termin vereinbaren";
const US_ABSENDER = "+12025550141";
const FR_ABSENDER = "+33612345678";
const DE_ABSENDER = "+4915799990011";
const MANDANT_US = "t_herkunft_us";
const MANDANT_FR = "t_herkunft_fr";
const MANDANT_DE = "t_herkunft_de";
const HERKUNFT = "herkunft";
const FORCE_US = Object.freeze({ FORCE_NUMBER_COUNTRY: "US" });
const SERVER_ENV = Object.freeze({
  FAKE_ORIGINATE: "true",
  VOICE_TARIFF_DEFAULT_CENTS: "30",
  VOICE_TARIFF_DOMESTIC_CENTS: "30",
});

const deutscherMandant = (id) => ({
  id,
  status: "active",
  kycLevel: "card",
  ownerName: "Eve Example",
  country: "DE",
  defaultLanguage: "de",
});

const nummer = (id, tenantId, e164, extra = {}) => ({
  id,
  e164,
  tenantId,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
  language: "de",
  ...extra,
});

function startMit(mandanten, nummern, env = {}) {
  return startServer({
    seed: seedState({
      tenants: mandanten.map(deutscherMandant),
      numbers: nummern,
      profiles: Object.fromEntries(mandanten.map((id) => [id, { maxCallsPerHour: 100 }])),
    }),
    env: { ...SERVER_ENV, ...env },
  });
}

async function anrufen(srv, tenantId) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": tenantId },
    body: JSON.stringify({ to: HEIMATZIEL, objective: AUFTRAG }),
  });
  return { status: res.status, body: await res.json() };
}

test("Herkunfts-Gate: DE-Mandant mit eigener +1-Nummer ruft +49 an - kein 403, ohne FORCE_NUMBER_COUNTRY", async () => {
  const srv = await startMit([MANDANT_US], [nummer("num_h_us", MANDANT_US, US_ABSENDER)]);
  try {
    const { status, body } = await anrufen(srv, MANDANT_US);
    assert.notEqual(body.reason, HERKUNFT);
    assert.equal(status, HTTP_OK);
  } finally {
    await srv.stop();
  }
});

test("Herkunfts-Gate: DE-Mandant mit +33-Absender ruft +49 an - weiter 403 grund=herkunft", async () => {
  const srv = await startMit([MANDANT_FR], [nummer("num_h_fr", MANDANT_FR, FR_ABSENDER)]);
  try {
    const { status, body } = await anrufen(srv, MANDANT_FR);
    assert.equal(status, HTTP_FORBIDDEN);
    assert.equal(body.reason, HERKUNFT);
  } finally {
    await srv.stop();
  }
});

test("Start mit FORCE_NUMBER_COUNTRY=US: keine Warnung dazu, eine Logzeile mit der Zahl aktiver Kundennummern ausserhalb +1", async () => {
  const srv = await startMit(
    [MANDANT_DE],
    [nummer("num_h_de", MANDANT_DE, DE_ABSENDER, { providerNumberId: "pnum_h_de", country: "DE" })],
    FORCE_US,
  );
  try {
    await waitForLog(srv, /\[kundennummern\] aktive_ausserhalb_plus1=\d+/);
    assert.match(srv.stdout, /\[kundennummern\] aktive_ausserhalb_plus1=1\n/);
    assert.doesNotMatch(srv.stdout, /FORCE_NUMBER_COUNTRY/);
  } finally {
    await srv.stop();
  }
});

test("Start mit FORCE_NUMBER_COUNTRY=US: nur +1-Kundennummern ergeben die Zahl 0 (Deploy-Vorbedingung)", async () => {
  const srv = await startMit(
    [MANDANT_US],
    [nummer("num_h_us0", MANDANT_US, US_ABSENDER, { providerNumberId: "pnum_h_us0" })],
    FORCE_US,
  );
  try {
    await waitForLog(srv, /\[kundennummern\] aktive_ausserhalb_plus1=\d+/);
    assert.match(srv.stdout, /\[kundennummern\] aktive_ausserhalb_plus1=0\n/);
  } finally {
    await srv.stop();
  }
});
