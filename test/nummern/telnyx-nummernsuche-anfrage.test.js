import { test } from "node:test";
import assert from "node:assert/strict";

import { gesendeteAnfrage } from "../gemeinsam/gesendete-anfrage.mjs";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-nummernsuche-anfrage";

const { numberProvisioning } = await import("../../src/telephony/registry.js");

async function sucheMit(suche) {
  const { urls } = await gesendeteAnfrage({ data: [] }, () =>
    numberProvisioning().searchNumbers(suche),
  );
  return urls[0];
}

test("Telnyx-Nummernsuche: fragt nur Nummern mit Sprachfunktion im gewünschten Land ab", async () => {
  const url = await sucheMit({ countryCode: "DE" });
  assert.equal(url.origin + url.pathname, "https://telnyx.test/v2/available_phone_numbers");
  assert.equal(url.searchParams.get("filter[country_code]"), "DE");
  assert.deepEqual(url.searchParams.getAll("filter[features][]"), ["voice"]);
});

test("Telnyx-Nummernsuche: ohne Nummerntyp fragt sie ohne Typfilter ab", async () => {
  const url = await sucheMit({ countryCode: "DE" });
  assert.equal(url.searchParams.has("filter[phone_number_type]"), false);
});

test("Telnyx-Nummernsuche: mit Nummerntyp fragt sie genau diesen Typ ab", async () => {
  const url = await sucheMit({ countryCode: "DE", type: "mobile" });
  assert.equal(url.searchParams.get("filter[phone_number_type]"), "mobile");
});

test("Telnyx-Nummernsuche: fragt so viele Nummern ab, wie der Aufrufer verlangt", async () => {
  const url = await sucheMit({ countryCode: "DE", limit: 7 });
  assert.equal(url.searchParams.get("filter[limit]"), "7");
});

test("Telnyx-Nummernsuche: ohne Angabe fragt sie genau eine Nummer ab", async () => {
  const url = await sucheMit({ countryCode: "DE" });
  assert.equal(url.searchParams.get("filter[limit]"), "1");
});
