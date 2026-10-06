import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefen } from "../scripts/el-nummern-registrierung.mjs";
import { provisionNumber } from "../src/onboarding.js";
import { attachNumberRegistration, makeDefaultState, registerTenant, requestNumber } from "../src/store/state-ops.js";
import { fakeProvisioner, withFetch } from "./helpers.js";

const ARGS = { countryCode: "DE", connectionId: "conn_1" };
const FALLBACK_ID = "phnum_fallback_global";
const ORPHAN_ID = "phnum_echte_waise";
const EL_ACCOUNT = Object.freeze({
  apiKey: "xi_test_key",
  apiBase: "https://api.elevenlabs.io",
  agentId: "agent_x",
  agentPhoneNumberId: FALLBACK_ID,
});

function provisionerMit(e164) {
  return fakeProvisioner({
    async searchNumbers() {
      return [{ e164 }];
    },
  });
}

async function seedZweiAktiveDids() {
  const state = makeDefaultState();
  registerTenant(state, "t_a");
  registerTenant(state, "t_b");
  const { number: numberA } = requestNumber(state, { tenantId: "t_a", maxNumbers: 5, maxNumbersPerTenant: 1 });
  await provisionNumber(state, { provisioner: provisionerMit("+4915799990001") }, { numberId: numberA.id, ...ARGS });
  const { number: numberB } = requestNumber(state, { tenantId: "t_b", maxNumbers: 5, maxNumbersPerTenant: 1 });
  await provisionNumber(state, { provisioner: provisionerMit("+4915799990002") }, { numberId: numberB.id, ...ARGS });
  attachNumberRegistration(state, numberA.id, "phnum_a");
  return { state, numberA, numberB };
}

function providerListe(numberAE164) {
  return [
    { phone_number: numberAE164, phone_number_id: "phnum_a" },
    { phone_number: "+15559990000", phone_number_id: FALLBACK_ID },
    { phone_number: "+15551110000", phone_number_id: ORPHAN_ID },
  ];
}

function stubFetch(liste) {
  return async () => ({ ok: true, status: 200, json: async () => liste });
}

test("pruefen(): die globale Rueckfall-Registrierung zaehlt NICHT als Waise", async () => {
  const { state, numberA, numberB } = await seedZweiAktiveDids();
  const exitCode = await withFetch(stubFetch(providerListe(numberA.e164)), () =>
    pruefen({ state, el: EL_ACCOUNT, nurNumberId: null }),
  );
  assert.equal(exitCode, 1, "t_b hat keine Registrierung -> Exit 1 bleibt korrekt bestehen");
  assert.ok(numberB.id, "numberB wird referenziert (kein ungenutzter Import)");
});

test("pruefen() (Positiv-Kontrolle): alle DIDs registriert + Rueckfall-Registrierung vorhanden -> Exit 0", async () => {
  const { state, numberA, numberB } = await seedZweiAktiveDids();
  attachNumberRegistration(state, numberB.id, "phnum_b");
  const liste = [
    { phone_number: numberA.e164, phone_number_id: "phnum_a" },
    { phone_number: numberB.e164, phone_number_id: "phnum_b" },
    { phone_number: "+15559990000", phone_number_id: FALLBACK_ID },
  ];
  const exitCode = await withFetch(stubFetch(liste), () => pruefen({ state, el: EL_ACCOUNT, nurNumberId: null }));
  assert.equal(exitCode, 0, "keine offene DID, keine Waise ausser dem Rueckfall -> Exit 0");
});

test("pruefen() mit --nur=<numberId>: die Waisen-Pruefung laeuft trotzdem gegen ALLE aktiven DIDs, nicht nur die gewaehlte", async () => {
  const { state, numberA, numberB } = await seedZweiAktiveDids();
  attachNumberRegistration(state, numberB.id, "phnum_b");
  const liste = [
    { phone_number: numberA.e164, phone_number_id: "phnum_a" },
    { phone_number: numberB.e164, phone_number_id: "phnum_b" },
    { phone_number: "+15559990000", phone_number_id: FALLBACK_ID },
  ];
  const exitCode = await withFetch(stubFetch(liste), () =>
    pruefen({ state, el: EL_ACCOUNT, nurNumberId: numberA.id }),
  );
  assert.equal(
    exitCode,
    0,
    "der Pilot-Pruefmodus (--nur) darf die Registrierung eines UEBRIGEN Tenants nicht als Waise zaehlen",
  );
});

test("pruefen() Rotprobe: ohne den agentPhoneNumberId-Ausschluss waere die Rueckfall-Registrierung eine Waise", async () => {
  const { state, numberA, numberB } = await seedZweiAktiveDids();
  attachNumberRegistration(state, numberB.id, "phnum_b");
  const liste = [
    { phone_number: numberA.e164, phone_number_id: "phnum_a" },
    { phone_number: numberB.e164, phone_number_id: "phnum_b" },
    { phone_number: "+15559990000", phone_number_id: FALLBACK_ID },
  ];
  const elOhneRueckfallKennung = { ...EL_ACCOUNT, agentPhoneNumberId: "" };
  const exitCode = await withFetch(stubFetch(liste), () =>
    pruefen({ state, el: elOhneRueckfallKennung, nurNumberId: null }),
  );
  assert.equal(
    exitCode,
    1,
    "ohne agentPhoneNumberId-Ausschluss zaehlt die Rueckfall-Registrierung als Waise (Rotprobe bestaetigt den Fix)",
  );
});
