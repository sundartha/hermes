// Review-Blocker Runde 1 (G26/P16 + G5) fuer scripts/el-nummern-registrierung.mjs#anlegen:
//
// G26/P16: saveState() wurde bisher NICHT awaited. Auf STORE_BACKEND=pg (die dokumentierte
// Betriebsvoraussetzung dieses Skripts, s. Modul-Kopf) ist save() asynchron (flushChain) -
// der anlegen-Loop lief damit vor jedem DB-Write weiter, und runCli(...) ging direkt in
// process.exit(), bevor der Flush fertig war. Der Test pinnt eine Fake-saveState, deren
// Promise ERST im naechsten Tick aufloest (Muster stt-model-seam.test.js) - loest anlegen()
// NICHT auf sie, laeuft die Zusicherung "Feld ist VOR dem naechsten Kandidaten persistiert"
// nicht durch.
//
// G5: providerAgentPhoneNumberId wird ueber attachNumberRegistration (state-ops.js)
// geschrieben statt per Direktzuweisung - derselbe set-once-Riegel wie im Produktionspfad
// (onboarding.js#registriereNummerFailSoft). Ein zweiter Anlauf auf eine Nummer, die
// zwischenzeitlich (Race) bereits eine Kennung bekam, ueberschreibt sie NICHT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anlegen } from "../scripts/el-nummern-registrierung.mjs";
import { provisionNumber } from "../src/onboarding.js";
import { makeDefaultState, registerTenant, requestNumber, findNumber } from "../src/store/state-ops.js";
import { fakeProvisioner } from "./helpers.js";

const EL_ACCOUNT = Object.freeze({ apiKey: "xi_test_key", apiBase: "https://api.elevenlabs.io", agentId: "agent_x" });
const SIP_USER = "sip_user_test";
const SIP_PASSWORT = "GEHEIMES_PASSWORT_XYZ";
const ARGS = { countryCode: "DE", connectionId: "conn_1" };

// Muster absender-registrierung-anlegen.test.js#seedRequested: requested -> active ueber
// den echten provisionNumber-Pfad (fakeProvisioner, KEIN sipRegistrar hier - die
// Registrierung ist genau das, was anlegen() im Test danach nachholt).
async function seedActiveTelnyxNummer(tenantId) {
  const state = makeDefaultState();
  registerTenant(state, tenantId);
  const { number } = requestNumber(state, { tenantId, maxNumbers: 5, maxNumbersPerTenant: 1 });
  await provisionNumber(state, { provisioner: fakeProvisioner() }, { numberId: number.id, ...ARGS });
  return { state, numberId: number.id };
}

function fetchAttrappe() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url, method });
    if (method === "POST")
      return { ok: true, status: 200, json: async () => ({ phone_number_id: "phnum_neu" }) };
    return { ok: true, status: 200, json: async () => [] };
  };
  return { fetchImpl, calls };
}

// G26: saveState wird AWAITED, bevor anlegen() zur naechsten Zeile geht - eine
// erst-im-naechsten-Tick aufloesende Attrappe muss VOR dem Log-Ausgang durchgelaufen sein.
test("G26: saveState wird awaited - der spaete Flush ist abgeschlossen, bevor anlegen() zurueckkehrt", async () => {
  const { state, numberId } = await seedActiveTelnyxNummer("t_g26");
  const { fetchImpl } = fetchAttrappe();
  let saveAufgeloest = false;
  const saveState = () =>
    new Promise((resolve) =>
      setTimeout(() => {
        saveAufgeloest = true;
        resolve();
      }, 0),
    );
  const exitCode = await anlegen({ state, saveState, el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, nurNumberId: null, fetchImpl });
  assert.equal(exitCode, 0);
  assert.equal(saveAufgeloest, true, "saveState() muss vor der Rueckkehr aufgeloest sein");
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, "phnum_neu");
});

// Positiv-Kontrolle (Vermeidungsliste 2): eine synchron aufloesende saveState-Attrappe
// bleibt unveraendert gruen.
test("G26 (Positiv-Kontrolle): synchrone saveState-Attrappe bleibt unveraendert gruen", async () => {
  const { state, numberId } = await seedActiveTelnyxNummer("t_g26b");
  const { fetchImpl } = fetchAttrappe();
  let saveAufrufe = 0;
  const saveState = async () => {
    saveAufrufe++;
  };
  const exitCode = await anlegen({ state, saveState, el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, nurNumberId: null, fetchImpl });
  assert.equal(exitCode, 0);
  assert.equal(saveAufrufe, 1);
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, "phnum_neu");
});

// G5: attachNumberRegistration ist set-once - eine Nummer, die WAEHREND des laufenden
// Anbieter-POSTs (Race, z.B. der Produktionspfad lief parallel durch) bereits eine Kennung
// bekam, wird von anlegen() beim Zurueckschreiben NICHT ueberschrieben. Die Race-Injektion
// sitzt bewusst IN der fetchImpl-Attrappe (zwischen POST-Antwort und dem Zurueckschreiben in
// anlegen()) - eine Injektion in saveState waere zu spaet, das Feld stuende dann schon.
test("G5: set-once ueber attachNumberRegistration - eine waehrend des Anbieter-Aufrufs gesetzte Kennung bleibt unangetastet", async () => {
  const { state, numberId } = await seedActiveTelnyxNummer("t_g5");
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url, method });
    if (method === "POST") {
      findNumber(state, numberId).providerAgentPhoneNumberId = "phnum_bereits_da_race";
      return { ok: true, status: 200, json: async () => ({ phone_number_id: "phnum_neu" }) };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  const saveState = async () => {};
  await anlegen({ state, saveState, el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, nurNumberId: null, fetchImpl });
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, "phnum_bereits_da_race");
  assert.equal(
    calls.filter((eintrag) => eintrag.method === "POST").length,
    1,
    "trotzdem genau 1 Anlege-Versuch (Kandidat war frei)",
  );
});
