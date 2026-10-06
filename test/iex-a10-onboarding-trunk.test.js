import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionNumber } from "../src/onboarding.js";
import { fetchPhoneNumber } from "../src/elevenlabs/convai.js";
import {
  inboundTrunkKoerper,
  inboundTrunkSchreibenErlaubt,
  inboundTrunkSchreiberWennErlaubt,
  makeElSipRegistrar,
  makeInboundTrunkSchreiber,
} from "../src/elevenlabs/nummern-registrierung.js";
import { makeTrunkSweep } from "../src/elevenlabs/inbound-trunk-beleg.js";
import {
  INIT_WEBHOOK_TOKEN_MIN_LENGTH,
  SIP_PASSWORD_MIN_LENGTH,
  zugangsFingerabdruck,
} from "../src/elevenlabs/inbound-path-decision.js";
import { INBOUND_EL_SCOPE } from "../src/elevenlabs/inbound-scope.js";
import { makeProvisioningOrchestrator } from "../src/worker/provisioning-orchestrator.js";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import {
  clearNumberElInboundTrunkBeleg,
  findNumber,
  makeDefaultState,
  markNumberElInboundTrunkBelegt,
  markProvisioningJob,
  recordProvisioningJob,
  registerTenant,
  requestNumber,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const EINMAL = 1;
const AGENT = "agent_iex_a10";
const FREMDER_AGENT = "agent_fremd_a10";
const SIP_USER = "iex-a10-sip-benutzer";
const SIP_USER_ALT = "iex-a10-alter-benutzer";
const SIP_PASSWORT = "geheim-iex-a10-passwort-".padEnd(SIP_PASSWORD_MIN_LENGTH, "x");
const INIT_TOKEN = "t".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH);
const TENANT = "t_iex_a10";
const GEKAUFTE_E164 = "+4915799990001";
const FREMDE_DID = "+493000009999";
const T0_ISO = "2026-09-15T08:00:00.000Z";
const EL_BASE = "https://el-attrappe.test";
const EINZEL_PFAD = "/v1/convai/phone-numbers/";
const ANGELEGTE_ID = "phnum_a10_neu";
const TRUNK_ADRESSE = "sip.telnyx.com";
const ONBOARDING_ARGS = Object.freeze({ countryCode: "DE", connectionId: "conn_a10" });
const CAPS = Object.freeze({ maxNumbers: 5, maxNumbersPerTenant: 1 });
const ISO_MUSTER = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SWEEP_ZEILE_PRAEFIX = "[el-trunk] sweep fertig";

const EL_OUTBOUND = Object.freeze({
  enabled: true,
  numberRegistrationEnabled: true,
  apiKey: "xi_a10_key",
  apiBase: EL_BASE,
  agentId: AGENT,
});
const EL_INBOUND = Object.freeze({
  enabled: true,
  scope: INBOUND_EL_SCOPE.REGISTRIERTE_DIDS,
  tenantIds: Object.freeze([TENANT]),
  sipUser: SIP_USER,
  sipPassword: SIP_PASSWORT,
  initWebhookToken: INIT_TOKEN,
});
const TELEPHONY = Object.freeze({ telnyxSipTrunkUsername: "trunk_user", telnyxSipTrunkPassword: "trunk_pw" });

function schreibConfig({ inbound = {}, outbound = {}, provisioningEnabled = true } = {}) {
  return {
    provisioning: { provisioningEnabled },
    voice: {
      elevenLabsOutbound: { ...EL_OUTBOUND, ...outbound },
      elevenLabsInbound: { ...EL_INBOUND, ...inbound },
    },
    telephony: TELEPHONY,
  };
}

function antwort(status, koerper) {
  return { ok: status < HTTP_BAD_REQUEST, status, json: async () => koerper };
}

function registrierung(e164, aenderung = {}) {
  return {
    phone_number: e164,
    assigned_agent: { agent_id: AGENT },
    outbound_trunk: { address: TRUNK_ADRESSE },
    inbound_trunk: { has_auth_credentials: true, username: SIP_USER, allowed_numbers: [e164] },
    ...aenderung,
  };
}

function mitTrunk(e164, trunkAenderung) {
  const basis = registrierung(e164);
  return { ...basis, inbound_trunk: { ...basis.inbound_trunk, ...trunkAenderung } };
}

function fakeEl({ registrierungen = {}, getStatus = {}, patchStatus = HTTP_OK, postStatus = HTTP_OK, patchErgebnis = {} } = {}) {
  const regs = structuredClone(registrierungen);
  const statusFolgen = structuredClone(getStatus);
  const aufrufe = [];

  function patche(id, koerper) {
    const { credentials, allowed_numbers: erlaubt } = koerper.inbound_trunk_config;
    const trunk = { has_auth_credentials: true, username: credentials.username, allowed_numbers: erlaubt };
    regs[id] = { ...regs[id], inbound_trunk: { ...trunk, ...patchErgebnis } };
    return antwort(HTTP_OK, regs[id]);
  }

  function lieseEinzeln(id) {
    const status = statusFolgen[id]?.shift() ?? HTTP_OK;
    if (status !== HTTP_OK) return antwort(status, {});
    return regs[id] ? antwort(HTTP_OK, regs[id]) : antwort(HTTP_NOT_FOUND, {});
  }

  function lege(koerper) {
    if (postStatus !== HTTP_OK) return antwort(postStatus, {});
    regs[ANGELEGTE_ID] = {
      phone_number: koerper.phone_number,
      assigned_agent: { agent_id: koerper.agent_id },
      outbound_trunk: { address: TRUNK_ADRESSE },
    };
    return antwort(HTTP_OK, { phone_number_id: ANGELEGTE_ID });
  }

  async function fetchImpl(url, init = {}) {
    const pfad = new URL(url).pathname;
    const method = init.method ?? "GET";
    const id = pfad.startsWith(EINZEL_PFAD) ? decodeURIComponent(pfad.slice(EINZEL_PFAD.length)) : null;
    const koerper = init.body ? JSON.parse(init.body) : null;
    aufrufe.push({ method, id, koerper, rohKoerper: init.body });
    if (method === "PATCH") return patchStatus === HTTP_OK ? patche(id, koerper) : antwort(patchStatus, { detail: init.body });
    if (method === "POST") return lege(koerper);
    if (id) return lieseEinzeln(id);
    return antwort(HTTP_OK, Object.entries(regs).map(([phoneNumberId, reg]) => ({ phone_number: reg.phone_number, phone_number_id: phoneNumberId })));
  }

  const patches = () => aufrufe.filter((aufruf) => aufruf.method === "PATCH");
  return { fetchImpl, aufrufe, patches };
}

function elReadVon(fetchImpl) {
  return { fetchPhoneNumber: (phoneNumberId) => fetchPhoneNumber({ fetchImpl, account: EL_OUTBOUND, phoneNumberId }) };
}

function fakeLogger() {
  const zeilen = [];
  return {
    log: (zeile) => zeilen.push({ stufe: "log", zeile }),
    warn: (zeile) => zeilen.push({ stufe: "warn", zeile }),
    error: (zeile) => zeilen.push({ stufe: "error", zeile }),
    text: () => zeilen.map((eintrag) => eintrag.zeile).join("\n"),
    mit: (praefix) => zeilen.filter((eintrag) => eintrag.zeile.startsWith(praefix)),
  };
}

function schreiberFuer({ fetchImpl, logger, inbound = {} }) {
  const cfg = schreibConfig({ inbound });
  return makeInboundTrunkSchreiber({ el: cfg.voice.elevenLabsOutbound, zugang: cfg.voice.elevenLabsInbound, fetchImpl, logger });
}

function ohneLeck(text, verboten) {
  for (const wert of verboten) assert.ok(!text.includes(wert), `Leck (${wert}) in: ${text}`);
}

const GESCHLOSSENE_GATES = [
  ["Scope allowlist", { inbound: { scope: INBOUND_EL_SCOPE.ALLOWLIST } }],
  ["Inbound aus", { inbound: { enabled: false } }],
  ["sipUser leer", { inbound: { sipUser: "" } }],
  ["sipPassword zu kurz", { inbound: { sipPassword: "kurz" } }],
  ["initWebhookToken fehlt", { inbound: { initWebhookToken: undefined } }],
  ["PROVISIONING_ENABLED aus", { provisioningEnabled: false }],
  ["Outbound aus", { outbound: { enabled: false } }],
  ["numberRegistrationEnabled aus", { outbound: { numberRegistrationEnabled: false } }],
  ["apiKey leer", { outbound: { apiKey: "" } }],
  ["agentId leer", { outbound: { agentId: "" } }],
];

test("IEX-A10-1: Gate-Tabelle - nur alles an + registrierte_dids baut einen Schreiber", () => {
  const offen = schreibConfig();
  assert.equal(inboundTrunkSchreibenErlaubt(offen), true);
  const schreiber = inboundTrunkSchreiberWennErlaubt(offen);
  assert.equal(typeof schreiber.ensureInboundTrunk, "function");
  assert.equal(schreiber.zugangFp, zugangsFingerabdruck(SIP_USER));
  for (const [zeile, variante] of GESCHLOSSENE_GATES) {
    const cfg = schreibConfig(variante);
    assert.equal(inboundTrunkSchreibenErlaubt(cfg), false, zeile);
    assert.equal(inboundTrunkSchreiberWennErlaubt(cfg), undefined, zeile);
  }
  assert.equal(inboundTrunkSchreiberWennErlaubt({ provisioning: { provisioningEnabled: false } }), undefined);
});

test("IEX-A10-2: inboundTrunkKoerper - exakte Form, jeder leere Wert wirft vor dem Netz", () => {
  const eingabe = { benutzer: SIP_USER, passwort: SIP_PASSWORT, e164: GEKAUFTE_E164 };
  assert.deepEqual(inboundTrunkKoerper(eingabe), {
    inbound_trunk_config: {
      credentials: { username: SIP_USER, password: SIP_PASSWORT },
      allowed_numbers: [GEKAUFTE_E164],
      allowed_addresses: ["0.0.0.0/0"],
    },
  });
  for (const feld of Object.keys(eingabe)) {
    for (const leer of ["", null, undefined]) {
      assert.throws(() => inboundTrunkKoerper({ ...eingabe, [feld]: leer }), /inboundTrunkKoerper/, `${feld}=${leer}`);
    }
  }
});

function drainStore(state) {
  return { load: () => state, save: () => {}, withStoreLock: async (arbeit) => arbeit() };
}

async function drainDeps(voice) {
  const state = makeDefaultState();
  state.numbers = [{ id: "num_a10_drain", tenantId: TENANT, status: NUMBER_STATUS.REQUESTED, e164: null, country: "DE" }];
  const erfasst = [];
  const orchestrator = makeProvisioningOrchestrator({
    store: drainStore(state),
    config: withConfigNamespaces({ provisioningEnabled: true, paymentEnabled: false, ...TELEPHONY, ...voice }),
    queue: makeMemoryQueue(),
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: (_state, _job, deps) => {
      erfasst.push(deps);
      return { number: null };
    },
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });
  await orchestrator.queueProvisioning("num_a10_drain", TENANT);
  await orchestrator.runProvisioningDrainExclusive();
  assert.equal(erfasst.length, EINMAL, "der Drain hat den Job verarbeitet");
  return erfasst[0];
}

test("IEX-A10-3: Produktionspfad - runProvisioningDrain injiziert den Schreiber nur unter registrierte_dids", async () => {
  const allowlist = await drainDeps({
    elevenLabsOutbound: EL_OUTBOUND,
    elevenLabsInbound: { ...EL_INBOUND, scope: INBOUND_EL_SCOPE.ALLOWLIST },
  });
  assert.equal(allowlist.inboundTrunkSchreiber, undefined);
  assert.equal(typeof allowlist.sipRegistrar?.ensureRegistration, "function", "Registrierung bleibt unberuehrt");
  const registriert = await drainDeps({ elevenLabsOutbound: EL_OUTBOUND, elevenLabsInbound: EL_INBOUND });
  assert.equal(typeof registriert.inboundTrunkSchreiber?.ensureInboundTrunk, "function");
});

async function onboarde({ el, inboundTrunkSchreiber, logger = fakeLogger() }) {
  const state = makeDefaultState();
  registerTenant(state, TENANT);
  const { number } = requestNumber(state, { tenantId: TENANT, ...CAPS });
  const sipRegistrar = makeElSipRegistrar({ el: EL_OUTBOUND, sipUser: "trunk_user", sipPasswort: "trunk_pw", fetchImpl: el.fetchImpl });
  const deps = { provisioner: fakeProvisioner(), sipRegistrar, inboundTrunkSchreiber, logger };
  const aktiviert = await provisionNumber(state, deps, { numberId: number.id, ...ONBOARDING_ARGS });
  return { aktiviert, gespeichert: findNumber(state, number.id), logger };
}

test("IEX-A10-4: Onboarding Erfolg - PATCH, Nach-GET, Beleg mit laufendem Fingerabdruck, Logs ohne Werte", async () => {
  const el = fakeEl();
  const logger = fakeLogger();
  const { aktiviert, gespeichert } = await onboarde({ el, logger, inboundTrunkSchreiber: schreiberFuer({ fetchImpl: el.fetchImpl, logger }) });

  assert.deepEqual(el.aufrufe.map(({ method, id }) => `${method}:${id ?? "liste"}`), ["GET:liste", "POST:liste", `PATCH:${ANGELEGTE_ID}`, `GET:${ANGELEGTE_ID}`]);
  assert.deepEqual(el.patches()[0].koerper, inboundTrunkKoerper({ benutzer: SIP_USER, passwort: SIP_PASSWORT, e164: GEKAUFTE_E164 }));
  assert.equal(aktiviert.status, NUMBER_STATUS.ACTIVE);
  assert.equal(gespeichert.elInboundTrunkZugangFp, zugangsFingerabdruck(SIP_USER));
  assert.match(gespeichert.elInboundTrunkBelegtAt, ISO_MUSTER);
  assert.deepEqual(logger.mit("[el-trunk]").map(({ zeile }) => zeile), [`[el-trunk] onboarding nummer_id=${gespeichert.id} beleg=belegt`]);
  ohneLeck(logger.text(), [SIP_PASSWORT, SIP_USER, GEKAUFTE_E164]);
});

test("IEX-A10-5: Onboarding unter allowlist - kein Schreiber, 0 PATCH, Registrierung unveraendert", async () => {
  const el = fakeEl();
  const inboundTrunkSchreiber = inboundTrunkSchreiberWennErlaubt(schreibConfig({ inbound: { scope: INBOUND_EL_SCOPE.ALLOWLIST } }));
  const { aktiviert, gespeichert, logger } = await onboarde({ el, inboundTrunkSchreiber });
  assert.equal(aktiviert.status, NUMBER_STATUS.ACTIVE);
  assert.equal(el.patches().length, 0);
  assert.equal(el.aufrufe.filter((aufruf) => aufruf.method === "POST").length, EINMAL);
  assert.equal(gespeichert.elInboundTrunkBelegtAt, undefined);
  assert.equal(gespeichert.elInboundTrunkZugangFp, undefined);
  assert.equal(logger.mit("[el-trunk]").length, 0);
});

test("IEX-A10-6: Onboarding PATCH 500 mit gespiegeltem Koerper - DID aktiv, kein Retry, kein Beleg, kein Leck", async () => {
  const el = fakeEl({ patchStatus: HTTP_SERVER_ERROR });
  const logger = fakeLogger();
  const { aktiviert, gespeichert } = await onboarde({ el, logger, inboundTrunkSchreiber: schreiberFuer({ fetchImpl: el.fetchImpl, logger }) });

  assert.equal(aktiviert.status, NUMBER_STATUS.ACTIVE);
  assert.equal(el.patches().length, EINMAL, "genau ein Schreibversuch");
  const [patch] = el.patches();
  assert.ok(patch.rohKoerper.includes(SIP_PASSWORT), "Positiv-Kontrolle: der Koerper trug das Passwort");
  assert.equal(gespeichert.elInboundTrunkBelegtAt, undefined);
  assert.equal(gespeichert.elInboundTrunkZugangFp, undefined);
  assert.match(logger.text(), new RegExp(`schreiben_fehlgeschlagen nummer_id=${gespeichert.id} status=${HTTP_SERVER_ERROR}`));
  assert.match(logger.text(), new RegExp(`onboarding nummer_id=${gespeichert.id} beleg=abweichung`));
  ohneLeck(logger.text(), [SIP_PASSWORT, SIP_USER, "detail"]);
});

test("IEX-A10-7: Onboarding PATCH angenommen, Nach-GET weicht ab (fremder Agent / andere Nummern) - kein Beleg", async () => {
  const faelle = [
    fakeEl({ registrierungen: { phnum_fremd: registrierung(GEKAUFTE_E164, { assigned_agent: { agent_id: FREMDER_AGENT } }) } }),
    fakeEl({ patchErgebnis: { allowed_numbers: [FREMDE_DID] } }),
  ];
  for (const el of faelle) {
    const logger = fakeLogger();
    const { aktiviert, gespeichert } = await onboarde({ el, logger, inboundTrunkSchreiber: schreiberFuer({ fetchImpl: el.fetchImpl, logger }) });
    assert.equal(aktiviert.status, NUMBER_STATUS.ACTIVE);
    assert.equal(el.patches().length, EINMAL);
    assert.equal(gespeichert.elInboundTrunkBelegtAt, undefined);
    assert.equal(gespeichert.elInboundTrunkZugangFp, undefined);
  }
});

test("IEX-A10-8: Onboarding ohne Trunk-Schreiben - (a) ohne Registrierung, (b) leerer Zugang wirft vor dem Netz", async () => {
  const ohneRegistrierung = fakeEl({ postStatus: HTTP_SERVER_ERROR });
  const loggerA = fakeLogger();
  const inboundTrunkSchreiber = schreiberFuer({ fetchImpl: ohneRegistrierung.fetchImpl, logger: loggerA });
  const fallA = await onboarde({ el: ohneRegistrierung, logger: loggerA, inboundTrunkSchreiber });
  assert.equal(fallA.aktiviert.status, NUMBER_STATUS.ACTIVE);
  assert.equal(ohneRegistrierung.patches().length, 0);
  assert.equal(loggerA.mit("[el-trunk]").length, 0);

  const el = fakeEl();
  const logger = fakeLogger();
  const kaputt = schreiberFuer({ fetchImpl: el.fetchImpl, logger, inbound: { sipPassword: "" } });
  const { aktiviert, gespeichert } = await onboarde({ el, logger, inboundTrunkSchreiber: kaputt });
  assert.equal(aktiviert.status, NUMBER_STATUS.ACTIVE);
  assert.equal(el.patches().length, 0);
  assert.deepEqual(logger.mit("[el-trunk]"), [
    { stufe: "warn", zeile: `[el-trunk] onboarding FEHLGESCHLAGEN nummer_id=${gespeichert.id} - DID bleibt nutzbar, Boot-Sweep prueft erneut` },
  ]);
  ohneLeck(logger.text(), ["inboundTrunkKoerper", "Pflicht"]);
});

const DID_A = "+493000000001";

function sweepStore(numbers) {
  const state = { ...makeDefaultState(), numbers };
  return {
    state,
    load: () => state,
    markNumberElInboundTrunkBelegt: (numberId, eingabe) => markNumberElInboundTrunkBelegt(state, numberId, eingabe),
    clearNumberElInboundTrunkBeleg: (numberId) => clearNumberElInboundTrunkBeleg(state, numberId),
  };
}

function aktiveNummer({ index, e164 = DID_A, registrierungsId = `phnum_a10_${index}`, belegFp = zugangsFingerabdruck(SIP_USER) }) {
  return {
    id: `num_a10_${index}`,
    e164,
    tenantId: TENANT,
    status: NUMBER_STATUS.ACTIVE,
    providerAgentPhoneNumberId: registrierungsId,
    elInboundTrunkBelegtAt: T0_ISO,
    elInboundTrunkZugangFp: belegFp,
  };
}

async function sweepe({ numbers, el, reparaturAn = true, inbound = {} }) {
  const store = sweepStore(numbers);
  const logger = fakeLogger();
  const config = schreibConfig({ inbound });
  const reparatur = reparaturAn ? schreiberFuer({ fetchImpl: el.fetchImpl, logger, inbound }) : undefined;
  const sweep = makeTrunkSweep({ store, config, elRead: elReadVon(el.fetchImpl), reparatur, logger, jetzt: () => new Date(T0_ISO) });
  await sweep.runBootSweep();
  const [ergebnisZeile] = logger.mit(SWEEP_ZEILE_PRAEFIX).map(({ zeile }) => zeile);
  return { store, logger, ergebnisZeile, nummer: store.state.numbers[0] };
}

const OHNE_PATCH = [
  { zeile: "fremder Agent", reg: registrierung(DID_A, { assigned_agent: { agent_id: FREMDER_AGENT } }), grund: "fremde_registrierung" },
  { zeile: "andere phone_number", reg: mitTrunk(FREMDE_DID, { allowed_numbers: [DID_A] }), grund: "fremde_registrierung" },
  { zeile: "ohne outbound_trunk", reg: { ...mitTrunk(DID_A, { username: SIP_USER_ALT }), outbound_trunk: null }, grund: "ohne_outbound_trunk" },
];

test("IEX-A10-9: Sweep-Reparatur-Tabelle - kein PATCH bei zu, 404, fremd, ohne outbound_trunk, unbekannt, belegt", async () => {
  const gateZu = await sweepe({ numbers: [aktiveNummer({ index: 1 })], el: fakeEl({ registrierungen: { phnum_a10_1: mitTrunk(DID_A, { username: SIP_USER_ALT }) } }), reparaturAn: false });
  assert.match(gateZu.ergebnisZeile, / belegt=0 repariert=0 abweichung=1 /);
  assert.equal(gateZu.nummer.elInboundTrunkBelegtAt, undefined, "Gate zu: Beleg geloescht, nicht repariert");
  assert.equal(gateZu.logger.mit("[el-trunk] nicht_repariert").length, 0);

  const nichtGefunden = fakeEl();
  const fall404 = await sweepe({ numbers: [aktiveNummer({ index: 1 })], el: nichtGefunden });
  assert.match(fall404.logger.text(), /nicht_repariert nummer_id=num_a10_1 grund=nicht_gefunden/);
  assert.equal(nichtGefunden.patches().length, 0);

  for (const { zeile, reg, grund } of OHNE_PATCH) {
    const el = fakeEl({ registrierungen: { phnum_a10_1: reg } });
    const lauf = await sweepe({ numbers: [aktiveNummer({ index: 1 })], el });
    assert.match(lauf.logger.text(), new RegExp(`nicht_repariert nummer_id=num_a10_1 grund=${grund}`), zeile);
    assert.equal(el.patches().length, 0, zeile);
  }

  const unbekannt = fakeEl({ registrierungen: { phnum_a10_1: registrierung(DID_A) }, getStatus: { phnum_a10_1: [HTTP_SERVER_ERROR] } });
  const fall500 = await sweepe({ numbers: [aktiveNummer({ index: 1 })], el: unbekannt });
  assert.match(fall500.logger.text(), /nicht_repariert nummer_id=num_a10_1 grund=unbekannt/);
  assert.equal(fall500.nummer.elInboundTrunkBelegtAt, T0_ISO, "UNBEKANNT laesst den alten Beleg stehen");
  assert.equal(unbekannt.patches().length, 0);

  const belegt = fakeEl({ registrierungen: { phnum_a10_1: registrierung(DID_A) } });
  const fallBelegt = await sweepe({ numbers: [aktiveNummer({ index: 1 })], el: belegt });
  assert.equal(fallBelegt.logger.mit("[el-trunk] nicht_repariert").length, 0);
  assert.equal(belegt.patches().length, 0);
});

const REPARIERBAR = [
  ["username anders", { username: SIP_USER_ALT }],
  ["has_auth_credentials false", { has_auth_credentials: false }],
  ["allowed_numbers anders", { allowed_numbers: [FREMDE_DID] }],
];

test("IEX-A10-9: Sweep-Reparatur-Tabelle - genau 1 PATCH bei reiner Inbound-Trunk-Abweichung, Nach-GET belegt", async () => {
  for (const [zeile, trunkAenderung] of REPARIERBAR) {
    const el = fakeEl({ registrierungen: { phnum_a10_1: mitTrunk(DID_A, trunkAenderung) } });
    const { nummer, ergebnisZeile } = await sweepe({ numbers: [aktiveNummer({ index: 1, belegFp: null })], el });
    assert.equal(el.patches().length, EINMAL, zeile);
    assert.equal(el.patches()[0].id, "phnum_a10_1", zeile);
    assert.equal(nummer.elInboundTrunkZugangFp, zugangsFingerabdruck(SIP_USER), zeile);
    assert.match(nummer.elInboundTrunkBelegtAt, ISO_MUSTER, zeile);
    assert.match(ergebnisZeile, / belegt=1 repariert=1 abweichung=0 /, zeile);
  }
});

test("IEX-A10-10: Onboarding-Rennen - alter Fingerabdruck am Datensatz, alter Benutzer beim Anbieter -> repariert auf neu", async () => {
  const el = fakeEl({ registrierungen: { phnum_a10_1: mitTrunk(DID_A, { username: SIP_USER_ALT }) } });
  const { nummer, ergebnisZeile } = await sweepe({ numbers: [aktiveNummer({ index: 1, belegFp: zugangsFingerabdruck(SIP_USER_ALT) })], el });
  assert.equal(el.patches().length, EINMAL);
  assert.equal(
    ergebnisZeile,
    "[el-trunk] sweep fertig scope=registrierte_dids aktiv=1 belegt=1 repariert=1 abweichung=0 unbekannt=0 ohne_registrierung=0",
  );
  assert.equal(nummer.elInboundTrunkZugangFp, zugangsFingerabdruck(SIP_USER));
});

test("IEX-A10-11: Reparatur-PATCH 500 - genau ein Versuch, Endstand abweichung, Beleg leer, kein Leck", async () => {
  const el = fakeEl({ registrierungen: { phnum_a10_1: mitTrunk(DID_A, { username: SIP_USER_ALT }) }, patchStatus: HTTP_SERVER_ERROR });
  const { nummer, ergebnisZeile, logger } = await sweepe({ numbers: [aktiveNummer({ index: 1 })], el });
  assert.equal(el.patches().length, EINMAL);
  assert.match(ergebnisZeile, / belegt=0 repariert=0 abweichung=1 /);
  assert.equal(nummer.elInboundTrunkBelegtAt, undefined);
  assert.equal(nummer.elInboundTrunkZugangFp, undefined);
  ohneLeck(logger.text(), [SIP_PASSWORT, SIP_USER, zugangsFingerabdruck(SIP_USER), DID_A, "phnum_", "detail"]);
});

test("IEX-A10-12: Nach-GET scheitert - unbekannt, nicht repariert, geloeschter Beleg bleibt geloescht", async () => {
  const el = fakeEl({
    registrierungen: { phnum_a10_1: mitTrunk(DID_A, { username: SIP_USER_ALT }) },
    getStatus: { phnum_a10_1: [HTTP_OK, HTTP_SERVER_ERROR] },
  });
  const { nummer, ergebnisZeile } = await sweepe({ numbers: [aktiveNummer({ index: 1 })], el });
  assert.equal(el.patches().length, EINMAL);
  assert.match(ergebnisZeile, / belegt=0 repariert=0 abweichung=0 unbekannt=1 /);
  assert.equal(nummer.elInboundTrunkBelegtAt, undefined, "fail-closed: kein Beleg ohne Lesebeweis");
});

test("IEX-A10-13: Zeilen-Kombinatorik - jede Kennung genau einmal, in fester Reihenfolge", async () => {
  const [didBelegt, didRepariert, didFremd, didUnbekannt, didOhne] = ["+493000000011", "+493000000012", "+493000000013", "+493000000014", "+493000000015"];
  const el = fakeEl({
    registrierungen: {
      phnum_belegt: registrierung(didBelegt),
      phnum_repariert: mitTrunk(didRepariert, { username: SIP_USER_ALT }),
      phnum_fremd: registrierung(didFremd, { assigned_agent: { agent_id: FREMDER_AGENT } }),
      phnum_unbekannt: registrierung(didUnbekannt),
    },
    getStatus: { phnum_unbekannt: [HTTP_SERVER_ERROR] },
  });
  const zuordnung = [
    [didBelegt, "phnum_belegt"],
    [didRepariert, "phnum_repariert"],
    [didFremd, "phnum_fremd"],
    [didUnbekannt, "phnum_unbekannt"],
    [didOhne, null],
  ];
  const numbers = zuordnung.map(([e164, registrierungsId], position) => aktiveNummer({ index: position + 1, e164, registrierungsId }));
  const { ergebnisZeile } = await sweepe({ numbers, el });
  const kennungen = ["aktiv", "belegt", "repariert", "abweichung", "unbekannt", "ohne_registrierung"];
  for (const kennung of kennungen) assert.equal(ergebnisZeile.split(` ${kennung}=`).length - EINMAL, EINMAL, kennung);
  assert.match(ergebnisZeile, / aktiv=5 belegt=2 repariert=1 abweichung=1 unbekannt=1 ohne_registrierung=1( |$)/);
  assert.equal(el.patches().length, EINMAL);
});
