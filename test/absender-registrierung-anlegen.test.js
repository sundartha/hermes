// OUTBOUND-E5 (F3): das ANLEGEN einer ElevenLabs-Nummernregistrierung. C1/C3 pruefen
// nummern-registrierung.js#makeElSipRegistrar direkt (die unreine Haelfte, ihr einziger
// Netzzugriff). C2/C4/C5/C6 pruefen die Einbettung in onboarding.js#provisionNumber
// (fehlertolerant, optional, secret-frei). Kein Netz - ausschliesslich eine lokale
// fetchImpl-Attrappe, die AUFGEZEICHNETE Anfragen liefert (Blocker-Vermeidungsliste 3:
// die Attrappe prueft ihr Argument, statt stur "ok" zurueckzugeben).
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
// Muster fakeProvisioner: die vom Fake gelieferte e164 (test/helpers.js).
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

// EINFACHE, AUFZEICHNENDE fetch-Attrappe: liefert konfigurierbare Listen-/Anlege-Antworten
// UND prueft, WAS gesendet wurde (Blocker 3) - "calls" traegt Methode + Body jeder Anfrage.
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

// C1: frische DID, Anbieterliste leer -> genau 1 POST; Koerper byte-genau.
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

// C2: Idempotenz 1 (Zustand) - eine Nummer, die bereits eine Kennung traegt, loest KEINEN
// Anbieter-Aufruf aus (auch kein GET). Simuliert per Vorbelegung des rohen Datensatzes VOR
// provisionNumber (activateNumber ruehrt providerAgentPhoneNumberId nicht an - die
// Vorbelegung ueberlebt Suche/Kauf/Aktivierung unveraendert).
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

// C3: Idempotenz 2 (Wiederanlauf) - Liste enthaelt die e164 bereits -> 0 POSTs, Kennung
// wird UEBERNOMMEN statt neu angelegt.
test("C3: Idempotenz 2 (Wiederanlauf) - Anbieterliste enthaelt die e164 -> 0 POSTs, Kennung uebernommen", async () => {
  const { fetchImpl, calls } = fetchAttrappe({
    listResponse: [{ phone_number: TEST_DID, phone_number_id: "phnum_bestand" }],
  });
  const registrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const ergebnis = await registrar.ensureRegistration({ e164: TEST_DID, numberId: "num_test3" });
  assert.deepEqual(ergebnis, { phoneNumberId: "phnum_bestand", angelegt: false });
  assert.equal(calls.filter((eintrag) => eintrag.method === "POST").length, 0, "kein POST");
});

// C4: Anbieter antwortet 500 beim POST -> provisionNumber liefert TROTZDEM die aktive
// Nummer, providerAgentPhoneNumberId bleibt unangelegt, kein failNumber (Status bleibt
// active), kein Provider-Release, kein Hold-Storno; genau EINE Warn-Zeile.
test("C4: Anbieter-500 beim Anlegen -> Nummer bleibt active, Feld bleibt unangelegt, EINE Warn-Zeile", async () => {
  const { state, numberId } = seedRequested();
  const { fetchImpl } = fetchAttrappe({ listResponse: [], createStatus: HTTP_SERVER_ERROR, createBody: {} });
  const sipRegistrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const { logger, warns } = captureLogger();
  const prov = fakeProvisioner();
  const result = await provisionNumber(state, { provisioner: prov, sipRegistrar, logger }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE, "die DID bleibt nutzbar");
  // KEINE Zuweisung im Fehlerfall - das Feld bleibt exakt so abwesend wie bei jeder
  // frischen Nummer ohne Registrierung (Muster C5, kein undefined/null-Drift durch den
  // fehlgeschlagenen Versuch).
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, undefined);
  assert.equal(warns.length, 1, "genau eine Warn-Zeile");
  assert.match(warns[0], /FEHLGESCHLAGEN/);
  assert.ok(!prov.log.some((zeile) => zeile.startsWith("release")), "kein Provider-Release");
});

// C5: Registrar NICHT injiziert (Schalter aus) -> Ablauf byte-identisch zum Bestand: 0
// Aufrufe, Feld bleibt unangelegt.
test("C5: sipRegistrar nicht injiziert -> byte-identisch zum Bestand (0 Aufrufe, Feld nicht angelegt)", async () => {
  const { state, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const result = await provisionNumber(state, { provisioner: prov }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(result.e164, GEKAUFTE_E164);
  assert.equal(findNumber(state, numberId).providerAgentPhoneNumberId, undefined);
});

// C6: das SIP-Passwort leakt NIE - weder in einer Log-/Warn-Zeile noch in einem
// Fehlertext, auch nicht beim Fehlschlag (C4-Szenario wiederholt, diesmal geprueft).
test("C6: das SIP-Passwort erscheint in keiner Log-/Warn-Zeile", async () => {
  const { state, numberId } = seedRequested();
  const { fetchImpl } = fetchAttrappe({ listResponse: [], createStatus: HTTP_SERVER_ERROR, createBody: {} });
  const sipRegistrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const { logger, logs, warns } = captureLogger();
  const prov = fakeProvisioner();
  await provisionNumber(state, { provisioner: prov, sipRegistrar, logger }, { numberId, ...ARGS });
  for (const zeile of [...logs, ...warns]) assert.ok(!zeile.includes(SIP_PASSWORT), `Passwort-Leak: ${zeile}`);
});

// Review-Blocker Runde 1 (Blocker 1/2/G4): FEHLENDE SIP-Zugangsdaten duerfen NIE zu einem
// echten Anbieter-Aufruf mit leeren credentials fuehren. C7/C8 pruefen makeElSipRegistrar
// direkt (0 Netzzugriffe VOR dem Wurf, Blocker-Vermeidungsliste 3: die Attrappe zaehlt ihre
// eigenen Aufrufe, statt stur "ok" zu behaupten). C9 ist die Positiv-Kontrolle (Vermeidungs-
// liste 2): derselbe Aufbau mit vollstaendigen Zugangsdaten bleibt unveraendert C1-gruen.
test("C7: leere SIP-Zugangsdaten -> ensureRegistration wirft VOR jedem Netzzugriff, 0 Anbieter-Aufrufe", async () => {
  const { fetchImpl, calls } = fetchAttrappe({ listResponse: [] });
  const registrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: "", sipPasswort: "", fetchImpl });
  await assert.rejects(
    () => registrar.ensureRegistration({ e164: TEST_DID, numberId: "num_test7" }),
    /TELNYX_SIP_TRUNK_USERNAME fehlt/,
  );
  assert.equal(calls.length, 0, "kein einziger Anbieter-Aufruf, auch kein GET");
});

// C8: derselbe Fall, aber ueber den Produktionspfad (provisionNumber) - fail-soft
// abgefangen, benannte Warn-Zeile, DID bleibt active, Feld bleibt leer (kein SET-ONCE mit
// einer kaputten Kennung, kein stiller Rueckfall auf quelle=tenant_did).
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

// C9 (Positiv-Kontrolle, Vermeidungsliste 2): vollstaendige Zugangsdaten -> unveraendert
// C1-Verhalten, kein Kollateralschaden durch die neue Pruefung.
test("C9 (Positiv-Kontrolle): vollstaendige Zugangsdaten -> genau 1 POST wie zuvor", async () => {
  const { fetchImpl, calls } = fetchAttrappe({ listResponse: [] });
  const registrar = makeElSipRegistrar({ el: EL_ACCOUNT, sipUser: SIP_USER, sipPasswort: SIP_PASSWORT, fetchImpl });
  const ergebnis = await registrar.ensureRegistration({ e164: TEST_DID, numberId: "num_test9" });
  assert.deepEqual(ergebnis, { phoneNumberId: "phnum_new", angelegt: true });
  assert.equal(calls.filter((eintrag) => eintrag.method === "POST").length, 1);
});
