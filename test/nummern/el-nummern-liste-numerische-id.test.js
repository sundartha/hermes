import { test } from "node:test";
import assert from "node:assert/strict";
import { trunkInventar } from "../../scripts/el-nummern-registrierung.mjs";

const HTTP_OK = 200;
const NUMERISCHE_ID = 12345;
const KONTO = Object.freeze({ apiKey: "xi_liste_key", apiBase: "https://el-liste.test" });

function antwort(daten) {
  return { ok: true, status: HTTP_OK, json: async () => daten, text: async () => JSON.stringify(daten) };
}

test("Anbieterliste mit numerischer phone_number_id: Einzelabruf geht auf die Id als Text", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return antwort([{ phone_number: "+12025550101", phone_number_id: NUMERISCHE_ID }]);
    return antwort({ phone_number: "+12025550101", phone_number_id: String(NUMERISCHE_ID) });
  };
  const exitCode = await trunkInventar({ el: KONTO, fetchImpl });
  assert.equal(urls.length, 2);
  assert.equal(urls[1], "https://el-liste.test/v1/convai/phone-numbers/12345");
  assert.equal(exitCode, 0);
});
