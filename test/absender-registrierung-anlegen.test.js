import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionNumber } from "../src/onboarding.js";
import { makeDefaultState, registerTenant, requestNumber, findNumber } from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";
import { makeElSipRegistrar, registrierungsKoerper } from "../src/elevenlabs/nummern-registrierung.js";

const EL_ACCOUNT = Object.freeze({ apiKey: "xi_test_key", apiBase: "https://api.elevenlabs.io", agentId: "agent_x" });
const SIP_USER = "sip_user_test";
const SIP_PASSWORT = "GEHEIMES_PASSWORT_XYZ";
const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1" };
const GEKAUFTE_E164 = "+4915799990001";
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const TEST_DID = "+18643028341";

function seedRequested() {
  const state = makeDefaultState();
  registerTenant(state, "t_user1");
  const { number } = requestNumber(state, { tenantId: "t_user1", ...CAPS });
  return { state, numberId: number.id };
}

function fetchAttrappe({ listResponse = [], createStatus = HTTP_OK, createBody = { phone_number_id: "phnum_new" } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (method === "POST")
      return { ok: createStatus < HTTP_SERVER_ERROR, status: createStatus, json: async () => createBody };
    return { ok: true, status: HTTP_OK, json: async () => listResponse };
  };
  return { fetchImpl, calls };
}

function captureLogger() {
  const logs = [];
  const warns = [];
  return {
    logger: { log: (...args) => logs.push(args.join(" ")), warn: (...args) => warns.push(args.join(" ")) },
    logs,
    warns,
  };
}

test("C1: frische DID, leere Anbieterliste -> genau 1 POST mit byte-genauem Koerper", async () => {
  const { fetchImpl, calls } = fetchAttrappe({ listResponse: [] });
  const registrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const ergebnis = await registrar.ensureRegistration({ e164: TEST_DID, numberId: "num_test1" });
  assert.deepEqual(ergebnis, { phoneNumberId: "phnum_new", angelegt: true });
  const posts = calls.filter((eintrag) => eintrag.method === "POST");
  assert.equal(posts.length, 1, "genau ein POST");
  assert.deepEqual(
    posts[0].body,
    registrierungsKoerper({ e164: TEST_DID, numberId: "num_test1", agentId: EL_ACCOUNT.agentId, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT }),
  );
  assert.equal(posts[0].body.phone_number, TEST_DID);
  assert.equal(posts[0].body.label, "hermes-num_test1");
  assert.equal(posts[0].body.provider, "sip_trunk");
  assert.deepEqual(posts[0].body.outbound_trunk_config, {
    address: "sip.telnyx.com",
    transport: "tcp",
    media_encryption: "disabled",
    credentials: { username: SIP_USER, password: SIP_PASSWORT },
    enabled_codecs: ["PCMU/8000"],
  });
  assert.equal(posts[0].body.inbound_trunk_config, undefined, "keine Inbound-Freigabe");
});

test("C2: Idempotenz 1 (Zustand) - Feld bereits gesetzt -> 0 Anbieter-Aufrufe", async () => {
  const { state, numberId } = seedRequested();
  findNumber(state, numberId).providerAgentPhoneNumberId = "phnum_bereits_da";
  const { fetchImpl, calls } = fetchAttrappe();
  const sipRegistrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const { logger } = captureLogger();
  const prov = fakeProvisioner();
  const result = await provisionNumber(state, { provisioner: prov, sipRegistrar, logger }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(calls.length, 0, "kein einziger Anbieter-Aufruf, auch kein GET");
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, "phnum_bereits_da", "Kennung unveraendert");
});

test("C3: Idempotenz 2 (Wiederanlauf) - Anbieterliste enthaelt die e164 -> 0 POSTs, Kennung uebernommen", async () => {
  const { fetchImpl, calls } = fetchAttrappe({
    listResponse: [{ phone_number: TEST_DID, phone_number_id: "phnum_bestand" }],
  });
  const registrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const ergebnis = await registrar.ensureRegistration({ e164: TEST_DID, numberId: "num_test3" });
  assert.deepEqual(ergebnis, { phoneNumberId: "phnum_bestand", angelegt: false });
  assert.equal(calls.filter((eintrag) => eintrag.method === "POST").length, 0, "kein POST");
});

test("C4: Anbieter-500 beim Anlegen -> Nummer bleibt active, Feld bleibt unangelegt, EINE Warn-Zeile", async () => {
  const { state, numberId } = seedRequested();
  const { fetchImpl } = fetchAttrappe({ listResponse: [], createStatus: HTTP_SERVER_ERROR, createBody: {} });
  const sipRegistrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const { logger, warns } = captureLogger();
  const prov = fakeProvisioner();
  const result = await provisionNumber(state, { provisioner: prov, sipRegistrar, logger }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE, "die DID bleibt nutzbar");
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, undefined);
  assert.equal(warns.length, 1, "genau eine Warn-Zeile");
  assert.match(warns[0], /FEHLGESCHLAGEN/);
  assert.ok(!prov.log.some((zeile) => zeile.startsWith("release")), "kein Provider-Release");
});

test("C5: sipRegistrar nicht injiziert -> byte-identisch zum Bestand (0 Aufrufe, Feld nicht angelegt)", async () => {
  const { state, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const result = await provisionNumber(state, { provisioner: prov }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(result.e164, GEKAUFTE_E164);
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, undefined);
});

test("C6: das SIP-Passwort erscheint in keiner Log-/Warn-Zeile", async () => {
  const { state, numberId } = seedRequested();
  const { fetchImpl } = fetchAttrappe({ listResponse: [], createStatus: HTTP_SERVER_ERROR, createBody: {} });
  const sipRegistrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const { logger, logs, warns } = captureLogger();
  const prov = fakeProvisioner();
  await provisionNumber(state, { provisioner: prov, sipRegistrar, logger }, { numberId, ...ARGS });
  for (const zeile of [...logs, ...warns]) assert.ok(!zeile.includes(SIP_PASSWORT), `Passwort-Leak: ${zeile}`);
});

test("C7: leere SIP-Zugangsdaten -> ensureRegistration wirft VOR jedem Netzzugriff, 0 Anbieter-Aufrufe", async () => {
  const { fetchImpl, calls } = fetchAttrappe({ listResponse: [] });
  const registrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: "", sipPasswort: "", fetchImpl });
  await assert.rejects(
    () => registrar.ensureRegistration({ e164: TEST_DID, numberId: "num_test7" }),
    /TELNYX_SIP_TRUNK_USERNAME fehlt/,
  );
  assert.equal(calls.length, 0, "kein einziger Anbieter-Aufruf, auch kein GET");
});

test("C8: leere SIP-Zugangsdaten ueber provisionNumber -> DID bleibt active, Feld bleibt leer, benannte Warn-Zeile, 0 Anbieter-Aufrufe", async () => {
  const { state, numberId } = seedRequested();
  const { fetchImpl, calls } = fetchAttrappe({ listResponse: [] });
  const sipRegistrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: "", sipPasswort: "", fetchImpl });
  const { logger, warns } = captureLogger();
  const prov = fakeProvisioner();
  const result = await provisionNumber(state, { provisioner: prov, sipRegistrar, logger }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(calls.length, 0, "kein einziger Anbieter-Aufruf");
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, undefined);
  assert.equal(warns.length, 1, "genau eine benannte Warn-Zeile");
  assert.match(warns[0], /FEHLGESCHLAGEN/);
});

test("C9 (Positiv-Kontrolle): vollstaendige Zugangsdaten -> genau 1 POST wie zuvor", async () => {
  const { fetchImpl, calls } = fetchAttrappe({ listResponse: [] });
  const registrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const ergebnis = await registrar.ensureRegistration({ e164: TEST_DID, numberId: "num_test9" });
  assert.deepEqual(ergebnis, { phoneNumberId: "phnum_new", angelegt: true });
  assert.equal(calls.filter((eintrag) => eintrag.method === "POST").length, 1);
});
