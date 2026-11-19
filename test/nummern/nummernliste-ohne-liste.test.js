import { test } from "node:test";
import assert from "node:assert/strict";
import { makeElSipRegistrar } from "../../src/elevenlabs/nummern-registrierung.js";

const EL_ACCOUNT = Object.freeze({ apiKey: "xi_test_key", apiBase: "https://api.elevenlabs.io", agentId: "agent_x" });
const HTTP_OK = 200;
const E164 = "+18643028341";
const FEHLERTEXT = "ElevenLabs Nummernliste: Antwort ohne Liste";

function registrarMitListe(listResponse) {
  const fetchImpl = async () => ({ ok: true, status: HTTP_OK, json: async () => listResponse });
  return makeElSipRegistrar({ el: EL_ACCOUNT, fetchImpl });
}

for (const [name, antwort] of [
  ["null", null],
  ["Objekt", { phone_numbers: [] }],
  ["Text", "keine Liste"],
]) {
  test(`Nummernliste: Antwort ${name} wirft Fehler mit Ursache statt TypeError`, async () => {
    await assert.rejects(
      registrarMitListe(antwort).ensureRegistration({ e164: E164, numberId: "num_1" }),
      (fehler) => fehler instanceof Error && !(fehler instanceof TypeError) && fehler.message === FEHLERTEXT,
    );
  });
}

test("Nummernliste: Antwort mit leerer Liste legt die Nummer an", async () => {
  const fetchImpl = async (url, init = {}) => ({
    ok: true,
    status: HTTP_OK,
    json: async () => (init.method === "POST" ? { phone_number_id: "phnum_new" } : []),
  });
  const registrar = makeElSipRegistrar({ el: EL_ACCOUNT, fetchImpl });
  assert.deepEqual(await registrar.ensureRegistration({ e164: E164, numberId: "num_1" }), { phoneNumberId: "phnum_new", angelegt: true });
});
