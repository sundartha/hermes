import { test } from "node:test";
import assert from "node:assert/strict";

import { mitKurzerFrist, antwortetNie } from "../gemeinsam/kurze-antwortfrist.mjs";
import { withFetch } from "../helpers.js";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-nummernfristen";

const { numberProvisioning } = await import("../../src/telephony/registry.js");

const E164 = "+4915112345678";
const HTTP_OK = 200;
const NUMMERN_LESEN_FRIST_MS = 10_000;
const NUMMER_FREIGEBEN_FRIST_MS = 15_000;

function ohneAntwort(run) {
  return mitKurzerFrist(() => withFetch(antwortetNie, run));
}

function antwortetNurAufDieBestellung(url, init = {}) {
  if (!String(url).includes("/v2/number_orders")) return antwortetNie(url, init);
  return Promise.resolve({
    ok: true,
    status: HTTP_OK,
    json: async () => ({ data: { phone_numbers: [{ phone_number: E164 }] } }),
  });
}

test("Telnyx-Fristen: antwortet Telnyx auf die Nummernsuche nicht, bricht searchNumbers nach 10 Sekunden ab", async () => {
  const fristen = await ohneAntwort(() =>
    assert.rejects(numberProvisioning().searchNumbers({ countryCode: "DE" }), {
      name: "TimeoutError",
    }),
  );
  assert.deepEqual(fristen, [NUMMERN_LESEN_FRIST_MS]);
});

test("Telnyx-Fristen: antwortet Telnyx nach der Bestellung nicht auf die Nummernauflösung, bricht orderNumber dort nach 10 Sekunden ab", async () => {
  const fristen = await mitKurzerFrist(() =>
    withFetch(antwortetNurAufDieBestellung, () =>
      assert.rejects(numberProvisioning().orderNumber({ e164: E164 }), { name: "TimeoutError" }),
    ),
  );
  assert.deepEqual(fristen, [NUMMERN_LESEN_FRIST_MS]);
});

test("Telnyx-Fristen: antwortet Telnyx auf die Nummernfreigabe nicht, bricht releaseNumber nach 15 Sekunden ab", async () => {
  const fristen = await ohneAntwort(() =>
    assert.rejects(numberProvisioning().releaseNumber("nummer-id-1"), { name: "TimeoutError" }),
  );
  assert.deepEqual(fristen, [NUMMER_FREIGEBEN_FRIST_MS]);
});
