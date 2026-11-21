import assert from "node:assert/strict";
import { test } from "node:test";

import { providerConfigRead } from "../../src/telephony/registry.js";
import { config } from "../../src/config.ts";
import { TELNYX_MESSZEILE_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { withFetch } from "../helpers.js";

const NUMMER = "+4930123456";
const TREFFER = { data: [{ phone_number: NUMMER, status: "active" }] };

function mitTelephony(werte, lauf) {
  const alt = { ...config.telephony };
  Object.assign(config.telephony, werte);
  return lauf().finally(() => Object.assign(config.telephony, alt));
}

function aufzeichnen() {
  const gesendet = [];
  const fetchImpl = (url, optionen) => {
    gesendet.push({ url: String(url), kopf: optionen.headers });
    const text = JSON.stringify(TREFFER);
    return Promise.resolve({ ok: true, status: 200, text: async () => text, json: async () => TREFFER });
  };
  return { gesendet, fetchImpl };
}

test("3400-telnyx: Leseanfrage geht an die Basisadresse und traegt den Schluessel als Bearer", async () => {
  const { gesendet, fetchImpl } = aufzeichnen();
  const antwort = await mitTelephony({ telnyxApiKey: TELNYX_MESSZEILE_SCHLUESSEL, telnyxApiBase: "https://api.example" }, () =>
    withFetch(fetchImpl, () => providerConfigRead("telnyx").findPhoneNumber(NUMMER)),
  );
  assert.deepEqual(antwort, { treffer: [{ e164: NUMMER, status: "active" }] });
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0].url, `https://api.example/v2/phone_numbers?filter%5Bphone_number%5D=${encodeURIComponent(NUMMER)}`);
  assert.equal(gesendet[0].kopf.Authorization, `Bearer ${TELNYX_MESSZEILE_SCHLUESSEL}`);
  assert.equal(gesendet[0].kopf["Content-Type"], "application/json");
});

test("3400-telnyx: ohne Schluessel geht keine Anfrage raus", async () => {
  for (const key of ["", undefined, null]) {
    const { gesendet, fetchImpl } = aufzeichnen();
    await assert.rejects(
      mitTelephony({ telnyxApiKey: key, telnyxApiBase: "https://api.example" }, () =>
        withFetch(fetchImpl, () => providerConfigRead("telnyx").findPhoneNumber(NUMMER)),
      ),
      /Telnyx: TELNYX_API_KEY fehlt/,
      String(key),
    );
    assert.equal(gesendet.length, 0);
  }
});
