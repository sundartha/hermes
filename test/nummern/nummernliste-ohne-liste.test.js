import { test } from "node:test";
import assert from "node:assert/strict";
import { elevenlabsNummern } from "../../src/elevenlabs/nummern-port.ts";
import { withFetch } from "../helpers.js";

const EL_OUTBOUND = Object.freeze({ apiKey: "xi_test_key", apiBase: "https://api.elevenlabs.io", agentId: "agent_x" });
const HTTP_OK = 200;
const E164 = "+18643028341";
const FEHLERTEXT = "ElevenLabs Nummernliste: Antwort ohne Liste";
const NUMMER = "num_liste_1";

function sipRegistrar() {
  return elevenlabsNummern().sipRegistrarWennAktiv({
    provisioning: { provisioningEnabled: true },
    voice: { elevenLabsOutbound: EL_OUTBOUND },
  });
}

function antwortMit(inhalt) {
  return async (_url, init = {}) => ({
    ok: true,
    status: HTTP_OK,
    json: async () => (init.method === "POST" ? { phone_number_id: "phnum_new" } : inhalt),
  });
}

for (const [name, antwort] of [
  ["null", null],
  ["Objekt", { phone_numbers: [] }],
  ["Text", "keine Liste"],
]) {
  test(`Nummernliste: Antwort ${name} wirft Fehler mit Ursache statt TypeError`, async () => {
    await withFetch(antwortMit(antwort), () =>
      assert.rejects(
        sipRegistrar().ensureRegistration({ e164: E164, numberId: NUMMER }),
        (fehler) => fehler instanceof Error && !(fehler instanceof TypeError) && fehler.message === FEHLERTEXT,
      ),
    );
  });
}

test("Nummernliste: Antwort mit leerer Liste legt die Nummer an", async () => {
  const ergebnis = await withFetch(antwortMit([]), () => sipRegistrar().ensureRegistration({ e164: E164, numberId: NUMMER }));
  assert.deepEqual(ergebnis, { phoneNumberId: "phnum_new", angelegt: true });
});

test("Liefert ElevenLabs beim Anlegen eine phone_number_id, die keine Zeichenkette ist, schlägt die Registrierung mit ‚lieferte keine phone_number_id‘ fehl", async () => {
  const antwort = async (_url, init = {}) => ({
    ok: true,
    status: HTTP_OK,
    json: async () => (init.method === "POST" ? { phone_number_id: 4711 } : []),
  });
  await withFetch(antwort, () =>
    assert.rejects(
      sipRegistrar().ensureRegistration({ e164: E164, numberId: NUMMER }),
      (fehler) =>
        fehler instanceof Error && fehler.message === "ElevenLabs-Nummernregistrierung lieferte keine phone_number_id",
    ),
  );
});

test("Steht die Nummer schon mit einer phone_number_id, die keine Zeichenkette ist, in der Liste, schlägt die Registrierung fehl, statt die ID zu übernehmen", async () => {
  const liste = [{ phone_number: E164, phone_number_id: 4711 }];
  await withFetch(antwortMit(liste), () =>
    assert.rejects(
      sipRegistrar().ensureRegistration({ e164: E164, numberId: NUMMER }),
      (fehler) =>
        fehler instanceof Error && fehler.message === "ElevenLabs-Nummernregistrierung lieferte keine phone_number_id",
    ),
  );
});
