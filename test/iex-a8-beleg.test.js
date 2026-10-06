import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  ROOT,
  EL_INBOUND_ACCESS_BOOT_ENV,
  TELNYX_TEST_TENANT_NUMBER,
  seedWithTelnyxNumber,
  startServer,
  waitForLog,
} from "./helpers.js";

let beleg, ops, jsonStore, makePgStore, PGlite, config, NUMBER_STATUS, BOOTSTRAP, pfad;
let dataDir;
let jsonSeq = 0;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-iex-a8-"));
  process.env.DATA_DIR = dataDir;
  ({ config } = await import("../src/config.js"));
  beleg = await import("../src/elevenlabs/inbound-trunk-beleg.js");
  pfad = await import("../src/elevenlabs/inbound-path-decision.js");
  ops = await import("../src/store/state-ops.js");
  jsonStore = await import("../src/store/json.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ NUMBER_STATUS, BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

const SIP_USER = "iex-a8-sip-benutzer";
const SIP_USER_ANDERS = "iex-a8-anderer-benutzer";
const HEX_SIP_USER = "0123456789abcdef";
const AGENT = "agent_iex_a8";
const T0_ISO = "2026-09-15T08:00:00.123Z";
const T1_ISO = "2026-09-15T09:30:00.456Z";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;
const FP_MUSTER = /^[0-9a-f]{16}$/;
const ERWARTETE_FP_LAENGE = 16;
const ZAHL_STATT_STRING = 42;
const KAPPUNG_UEBERHANG = 2;
const MISCH_ANZAHL = 6;
const ZEIT_ANZAHL = 6;
const MAX_FLUSH_RUNDEN = 50;
const E2E_TIMEOUT_MS = 10000;
const GEHEIMER_FEHLERTEXT = "GEHEIM-iex-a8-fehlertext";
const FREMDE_DID = "+493000009999";
const ZWEITE_NUMMER = 2;

function sha256Hex16(wert) {
  const hex = crypto.createHash("sha256").update(wert).digest("hex");
  return hex.slice(0, ERWARTETE_FP_LAENGE);
}

function didFuer(index) {
  return `+49300000${String(index).padStart(pfad.DID_ENDUNG_ZIFFERN, "0")}`;
}

function nummer({ index, status = "active", registrierungsId = `phnum_a8_${index}`, ...rest }) {
  return {
    id: `num_a8_${index}`,
    e164: didFuer(index),
    tenantId: "tenant_a8",
    status,
    providerAgentPhoneNumberId: registrierungsId,
    ...rest,
  };
}

function passendeRegistrierung(e164) {
  return {
    phone_number: e164,
    assigned_agent: { agent_id: AGENT },
    inbound_trunk: { has_auth_credentials: true, username: SIP_USER, allowed_numbers: [e164] },
  };
}

function sweepConfig({ enabled = true, sipUser = SIP_USER, sipPassword, apiKey = "key_a8", agentId = AGENT } = {}) {
  return {
    voice: {
      elevenLabsInbound: {
        enabled,
        tenantIds: ["tenant_a8"],
        scope: "allowlist",
        sipUser,
        sipPassword: sipPassword ?? "p".repeat(pfad.SIP_PASSWORD_MIN_LENGTH),
        initWebhookToken: "t".repeat(pfad.INIT_WEBHOOK_TOKEN_MIN_LENGTH),
      },
      elevenLabsOutbound: { apiKey, agentId },
    },
  };
}

function fakeLogger() {
  const zeilen = [];
  return {
    zeilen,
    log: (zeile) => zeilen.push({ stufe: "log", zeile }),
    warn: (zeile) => zeilen.push({ stufe: "warn", zeile }),
    error: (zeile) => zeilen.push({ stufe: "error", zeile }),
    text: () => zeilen.map((eintrag) => eintrag.zeile).join("\n"),
  };
}

function fakeStore(numbers, ueberschreibungen = {}) {
  const state = { ...ops.makeDefaultState(), numbers };
  const aufrufe = { mark: 0, clear: 0 };
  return {
    state,
    aufrufe,
    load: () => state,
    markNumberElInboundTrunkBelegt(numberId, eingabe) {
      aufrufe.mark += 1;
      return ops.markNumberElInboundTrunkBelegt(state, numberId, eingabe);
    },
    clearNumberElInboundTrunkBeleg(numberId) {
      aufrufe.clear += 1;
      return ops.clearNumberElInboundTrunkBeleg(state, numberId);
    },
    ...ueberschreibungen,
  };
}

function fakeElRead(antworten) {
  const abrufe = [];
  return {
    abrufe,
    fetchPhoneNumber: async (phoneNumberId) => {
      abrufe.push(phoneNumberId);
      return antworten[phoneNumberId]();
    },
  };
}

function anbieterFehler(status) {
  const fehler = new Error(`ElevenLabs Nummernabruf fehlgeschlagen: HTTP ${status}`);
  fehler.providerStatus = status;
  return fehler;
}

function lauf({ store, elRead, config: sweepKonfig = sweepConfig(), logger = fakeLogger() }) {
  const sweep = beleg.makeTrunkSweep({ store, config: sweepKonfig, elRead, logger, jetzt: () => new Date(T0_ISO) });
  return { logger, laeuft: sweep.runBootSweep() };
}

test("IEX-A8-1: Fingerabdruck ist deterministisch, 16 Hex von sha256(sipUser), leer/kein String -> null", () => {
  const fp = pfad.zugangsFingerabdruck(SIP_USER);
  assert.equal(pfad.ZUGANG_FP_HEX_ZEICHEN, ERWARTETE_FP_LAENGE);
  assert.equal(pfad.zugangsFingerabdruck(SIP_USER), fp);
  assert.match(fp, FP_MUSTER);
  assert.equal(fp, sha256Hex16(SIP_USER));
  assert.notEqual(pfad.zugangsFingerabdruck(SIP_USER_ANDERS), fp);
  assert.notEqual(fp, SIP_USER);
  assert.notEqual(pfad.zugangsFingerabdruck(HEX_SIP_USER), HEX_SIP_USER);
  assert.equal(pfad.zugangsFingerabdruck(""), null);
  assert.equal(pfad.zugangsFingerabdruck(undefined), null);
  assert.equal(pfad.zugangsFingerabdruck(ZAHL_STATT_STRING), null);
});

const DID_BASIS = "+493000001111";

function mitTrunk(aenderung) {
  const reg = passendeRegistrierung(DID_BASIS);
  return { ...reg, inbound_trunk: { ...reg.inbound_trunk, ...aenderung } };
}
function ohneFeld(objekt, feld) {
  const { [feld]: _entfernt, ...rest } = objekt;
  return rest;
}
function trunkOhne(feld) {
  const reg = passendeRegistrierung(DID_BASIS);
  return { ...reg, inbound_trunk: ohneFeld(reg.inbound_trunk, feld) };
}
function mitRegistrierung(aenderung) {
  return { ...passendeRegistrierung(DID_BASIS), ...aenderung };
}

const ABWEICHUNGS_FAELLE = [
  ["has_auth_credentials false", () => mitTrunk({ has_auth_credentials: false }), {}],
  ["has_auth_credentials fehlt", () => trunkOhne("has_auth_credentials"), {}],
  ["username anders", () => mitTrunk({ username: SIP_USER_ANDERS }), {}],
  ["username fehlt und sipUser leer (G3)", () => trunkOhne("username"), { sipUser: "" }],
  ["allowed_numbers anders", () => mitTrunk({ allowed_numbers: [FREMDE_DID] }), {}],
  ["allowed_numbers [DID, fremd]", () => mitTrunk({ allowed_numbers: [DID_BASIS, FREMDE_DID] }), {}],
  ["allowed_numbers fehlt", () => trunkOhne("allowed_numbers"), {}],
  ["agent_id anders", () => mitRegistrierung({ assigned_agent: { agent_id: "agent_fremd" } }), {}],
  ["agent_id fehlt", () => mitRegistrierung({ assigned_agent: {} }), {}],
  ["agentId leer", () => passendeRegistrierung(DID_BASIS), { agentId: "" }],
  ["phone_number anders (D2)", () => mitRegistrierung({ phone_number: FREMDE_DID }), {}],
  ["registrierung null", () => null, {}],
  ["registrierung {}", () => ({}), {}],
];

test("IEX-A8-2: belegeInboundTrunk - Basisfall BELEGT", () => {
  const ergebnis = beleg.belegeInboundTrunk({
    number: { e164: DID_BASIS },
    registrierung: passendeRegistrierung(DID_BASIS),
    sipUser: SIP_USER,
    agentId: AGENT,
  });
  assert.equal(ergebnis, beleg.TRUNK_BELEG.BELEGT);
});

for (const [label, baueRegistrierung, eingaben] of ABWEICHUNGS_FAELLE) {
  test(`IEX-A8-2: belegeInboundTrunk - ${label} -> ABWEICHUNG, wirft nie`, () => {
    const ergebnis = beleg.belegeInboundTrunk({
      number: { e164: DID_BASIS },
      registrierung: baueRegistrierung(),
      sipUser: SIP_USER,
      agentId: AGENT,
      ...eingaben,
    });
    assert.equal(ergebnis, beleg.TRUNK_BELEG.ABWEICHUNG);
  });
}

test("IEX-A8-3: nur 404 ist ABWEICHUNG, jeder andere Abruffehler UNBEKANNT", () => {
  assert.equal(beleg.belegAusAbruffehler(anbieterFehler(HTTP_NOT_FOUND)), beleg.TRUNK_BELEG.ABWEICHUNG);
  for (const status of [HTTP_UNAUTHORIZED, HTTP_FORBIDDEN, HTTP_TOO_MANY, HTTP_SERVER_ERROR]) {
    assert.equal(beleg.belegAusAbruffehler(anbieterFehler(status)), beleg.TRUNK_BELEG.UNBEKANNT, `HTTP ${status}`);
  }
  assert.equal(beleg.belegAusAbruffehler(new Error("fetch failed")), beleg.TRUNK_BELEG.UNBEKANNT);
});

test("IEX-A8-4: trunkSweepHindernis in fester Reihenfolge", () => {
  assert.equal(beleg.trunkSweepHindernis(sweepConfig({ enabled: false }).voice), "schalter_aus");
  assert.equal(beleg.trunkSweepHindernis(sweepConfig({ sipPassword: "kurz" }).voice), "zugang_unvollstaendig");
  assert.equal(beleg.trunkSweepHindernis(sweepConfig({ apiKey: "" }).voice), "el_konto_unvollstaendig");
  assert.equal(beleg.trunkSweepHindernis(sweepConfig({ agentId: "" }).voice), "el_konto_unvollstaendig");
  assert.equal(beleg.trunkSweepHindernis(sweepConfig().voice), null);
});

function opsState(numbers) {
  return { ...ops.makeDefaultState(), numbers };
}

test("IEX-A8-5: markNumberElInboundTrunkBelegt - setzt beide Felder, set-once je Fingerabdruck", () => {
  const state = opsState([nummer({ index: 1 })]);
  const erst = ops.markNumberElInboundTrunkBelegt(state, "num_a8_1", { nowIso: T0_ISO, zugangFp: "fp_alt" });
  assert.equal(erst.changed, true);
  assert.equal(erst.number.elInboundTrunkBelegtAt, T0_ISO);
  assert.equal(erst.number.elInboundTrunkZugangFp, "fp_alt");

  const gleich = ops.markNumberElInboundTrunkBelegt(state, "num_a8_1", { nowIso: T1_ISO, zugangFp: "fp_alt" });
  assert.equal(gleich.changed, false);
  assert.equal(state.numbers[0].elInboundTrunkBelegtAt, T0_ISO, "belegtAt bleibt der erste Wert");

  const rotiert = ops.markNumberElInboundTrunkBelegt(state, "num_a8_1", { nowIso: T1_ISO, zugangFp: "fp_neu" });
  assert.equal(rotiert.changed, true);
  assert.equal(state.numbers[0].elInboundTrunkBelegtAt, T1_ISO);
  assert.equal(state.numbers[0].elInboundTrunkZugangFp, "fp_neu");
});

test("IEX-A8-5: markNumberElInboundTrunkBelegt - nicht aktive oder unbekannte Nummer bleibt unberuehrt", () => {
  const state = opsState([
    nummer({ index: 1, status: NUMBER_STATUS.SUSPENDED }),
    nummer({ index: 2, status: NUMBER_STATUS.RELEASED }),
  ]);
  const vorher = structuredClone(state.numbers);
  for (const numberId of ["num_a8_1", "num_a8_2", "num_unbekannt"]) {
    const { changed } = ops.markNumberElInboundTrunkBelegt(state, numberId, { nowIso: T0_ISO, zugangFp: "fp" });
    assert.equal(changed, false, numberId);
  }
  assert.deepEqual(state.numbers, vorher);
});

test("IEX-A8-5: markNumberElInboundTrunkBelegt - fehlende Eingaben werfen mit Funktionsnamen", () => {
  const state = opsState([nummer({ index: 1 })]);
  assert.throws(
    () => ops.markNumberElInboundTrunkBelegt(state, "num_a8_1", { nowIso: T0_ISO }),
    /markNumberElInboundTrunkBelegt/,
  );
  assert.throws(
    () => ops.markNumberElInboundTrunkBelegt(state, "num_a8_1", { zugangFp: "fp" }),
    /markNumberElInboundTrunkBelegt/,
  );
});

test("IEX-A8-6: clearNumberElInboundTrunkBeleg - entfernt beide Felder, ohne Beleg changed=false", () => {
  const state = opsState([
    nummer({ index: 1, elInboundTrunkBelegtAt: T0_ISO, elInboundTrunkZugangFp: "fp" }),
    nummer({ index: 2 }),
  ]);
  const geloescht = ops.clearNumberElInboundTrunkBeleg(state, "num_a8_1");
  assert.equal(geloescht.changed, true);
  assert.equal("elInboundTrunkBelegtAt" in state.numbers[0], false);
  assert.equal("elInboundTrunkZugangFp" in state.numbers[0], false);
  assert.equal(ops.clearNumberElInboundTrunkBeleg(state, "num_a8_1").changed, false);
  assert.equal(ops.clearNumberElInboundTrunkBeleg(state, "num_a8_2").changed, false);
  assert.equal(ops.clearNumberElInboundTrunkBeleg(state, "num_unbekannt").changed, false);
});

test("IEX-A8-7: releaseNumber entfernt den Beleg zusammen mit der Registrierung", () => {
  const state = opsState([nummer({ index: 1, elInboundTrunkBelegtAt: T0_ISO, elInboundTrunkZugangFp: "fp" })]);
  const number = ops.releaseNumber(state, "num_a8_1");
  assert.equal("elInboundTrunkBelegtAt" in number, false);
  assert.equal("elInboundTrunkZugangFp" in number, false);
  assert.equal(number.providerAgentPhoneNumberId, null);
});

function storeDatei() {
  return path.join(dataDir, "store.json");
}

function nummerAufPlatte(numberId) {
  const roh = JSON.parse(fs.readFileSync(storeDatei(), "utf8"));
  return { roh, number: roh.numbers.find((eintrag) => eintrag.id === numberId) };
}

test("IEX-A8-8: json-Wrapper speichert nur bei Aenderung und die Felder ueberleben einen frischen Import", async () => {
  assert.equal(config.server.dataDir, dataDir, "Positiv-Kontrolle: der json-Store schreibt ins Temp-Verzeichnis");
  const state = jsonStore.load();
  state.numbers.push(nummer({ index: 1 }));
  jsonStore.save();

  const ergebnis = jsonStore.markNumberElInboundTrunkBelegt("num_a8_1", { nowIso: T0_ISO, zugangFp: "fp_json" });
  assert.equal(ergebnis.changed, true);
  const { roh, number } = nummerAufPlatte("num_a8_1");
  assert.equal(number.elInboundTrunkBelegtAt, T0_ISO);
  assert.equal(number.elInboundTrunkZugangFp, "fp_json");

  fs.writeFileSync(storeDatei(), JSON.stringify({ ...roh, _spion: true }));
  assert.equal(jsonStore.markNumberElInboundTrunkBelegt("num_a8_1", { nowIso: T1_ISO, zugangFp: "fp_json" }).changed, false);
  assert.equal(nummerAufPlatte("num_a8_1").roh._spion, true, "kein Save ohne Aenderung");
  jsonStore.save();

  const reopened = await import(`../src/store/json.js?iex-a8-beleg=${jsonSeq++}`);
  const hydriert = reopened.load().numbers.find((eintrag) => eintrag.id === "num_a8_1");
  assert.equal(hydriert.elInboundTrunkBelegtAt, T0_ISO);
  assert.equal(hydriert.elInboundTrunkZugangFp, "fp_json");

  assert.equal(jsonStore.clearNumberElInboundTrunkBeleg("num_a8_1").changed, true);
  const nachClear = await import(`../src/store/json.js?iex-a8-clear=${jsonSeq++}`);
  const ohneBeleg = nachClear.load().numbers.find((eintrag) => eintrag.id === "num_a8_1");
  assert.equal("elInboundTrunkBelegtAt" in ohneBeleg, false);
  assert.equal("elInboundTrunkZugangFp" in ohneBeleg, false);
});

async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

async function reopen(runner) {
  const reopened = makePgStore(runner);
  await reopened.init();
  return reopened;
}

function aktiveNummerIn(state, { tenantId, e164 }) {
  ops.registerTenant(state, tenantId);
  const { number } = ops.requestNumber(state, { tenantId, maxNumbers: 10, maxNumbersPerTenant: 5 });
  ops.beginProvisioning(state, number.id);
  ops.activateNumber(state, number.id, { e164, providerNumberId: `ext_${tenantId}` });
  return number.id;
}

function pgNummer(store, numberId) {
  return store.load().numbers.find((eintrag) => eintrag.id === numberId);
}

test("IEX-A8-9: pg - Beleg ueberlebt Reopen und Folge-Flush, Clear und Bestand ohne Beleg sind abwesend", async () => {
  const { store, runner } = await makePgTestStore();
  const mitBeleg = aktiveNummerIn(store.load(), { tenantId: "t_a8_pg1", e164: didFuer(1) });
  const ohneBeleg = aktiveNummerIn(store.load(), { tenantId: "t_a8_pg2", e164: didFuer(ZWEITE_NUMMER) });
  store.markNumberElInboundTrunkBelegt(mitBeleg, { nowIso: T0_ISO, zugangFp: "fp_pg" });
  await store.save();

  const erster = await reopen(runner);
  assert.equal(pgNummer(erster, mitBeleg).elInboundTrunkBelegtAt, T0_ISO, "identischer ISO-String (Millisekunden)");
  assert.equal(pgNummer(erster, mitBeleg).elInboundTrunkZugangFp, "fp_pg");
  assert.equal("elInboundTrunkBelegtAt" in pgNummer(erster, ohneBeleg), false);
  assert.equal("elInboundTrunkZugangFp" in pgNummer(erster, ohneBeleg), false);

  ops.attachNumberRegistration(erster.load(), mitBeleg, "phnum_pg_folge");
  await erster.save();
  const zweiter = await reopen(runner);
  assert.equal(pgNummer(zweiter, mitBeleg).elInboundTrunkBelegtAt, T0_ISO);
  assert.equal(pgNummer(zweiter, mitBeleg).elInboundTrunkZugangFp, "fp_pg");

  assert.equal(zweiter.clearNumberElInboundTrunkBeleg(mitBeleg).changed, true);
  await zweiter.save();
  const dritter = await reopen(runner);
  assert.equal("elInboundTrunkBelegtAt" in pgNummer(dritter, mitBeleg), false);
  assert.equal("elInboundTrunkZugangFp" in pgNummer(dritter, mitBeleg), false);
});

test("IEX-A8-10: Ergebniszeile - 0 aktiv", async () => {
  const { logger, laeuft } = lauf({ store: fakeStore([]), elRead: fakeElRead({}) });
  await laeuft;
  assert.deepEqual(logger.zeilen, [
    { stufe: "log", zeile: "[el-trunk] sweep fertig scope=allowlist aktiv=0 belegt=0 repariert=0 abweichung=0 unbekannt=0 ohne_registrierung=0" },
  ]);
});

test("IEX-A8-10: Ergebniszeile - 1 belegt ohne Endungsteil", async () => {
  const eine = nummer({ index: 1 });
  const elRead = fakeElRead({ [eine.providerAgentPhoneNumberId]: () => passendeRegistrierung(eine.e164) });
  const { logger, laeuft } = lauf({ store: fakeStore([eine]), elRead });
  await laeuft;
  assert.equal(logger.text(), "[el-trunk] sweep fertig scope=allowlist aktiv=1 belegt=1 repariert=0 abweichung=0 unbekannt=0 ohne_registrierung=0");
});

function mischfall() {
  const numbers = [
    nummer({ index: 6, registrierungsId: null }),
    nummer({ index: 3 }),
    nummer({ index: 1 }),
    nummer({ index: 5 }),
    nummer({ index: 2 }),
    nummer({ index: 4 }),
  ];
  const elRead = fakeElRead({
    phnum_a8_1: () => passendeRegistrierung(didFuer(1)),
    phnum_a8_2: () => ({ ...passendeRegistrierung(didFuer(ZWEITE_NUMMER)), assigned_agent: { agent_id: "agent_fremd" } }),
    phnum_a8_3: () => Promise.reject(anbieterFehler(HTTP_NOT_FOUND)),
    phnum_a8_4: () => Promise.reject(anbieterFehler(HTTP_SERVER_ERROR)),
    phnum_a8_5: () => Promise.reject(new Error("fetch failed")),
  });
  return { numbers, elRead };
}

test("IEX-A8-10: Ergebniszeile - n gemischt, Endungen sortiert", async () => {
  const { numbers, elRead } = mischfall();
  assert.equal(numbers.length, MISCH_ANZAHL);
  const { logger, laeuft } = lauf({ store: fakeStore(numbers), elRead });
  await laeuft;
  assert.equal(
    logger.text(),
    "[el-trunk] sweep fertig scope=allowlist aktiv=6 belegt=1 repariert=0 abweichung=2 unbekannt=2 ohne_registrierung=1 " +
      "ohne_beleg_endungen=…0002,…0003,…0004,…0005,…0006",
  );
});

test("IEX-A8-10: Ergebniszeile - Kappung auf SONDE_MAX_ENDUNGEN plus Rest", async () => {
  const anzahl = beleg.SONDE_MAX_ENDUNGEN + KAPPUNG_UEBERHANG;
  const ersteIndex = 101;
  const numbers = Array.from({ length: anzahl }, (_leer, versatz) =>
    nummer({ index: ersteIndex + versatz, registrierungsId: null }),
  );
  const { logger, laeuft } = lauf({ store: fakeStore(numbers), elRead: fakeElRead({}) });
  await laeuft;
  const sichtbar = numbers.slice(0, beleg.SONDE_MAX_ENDUNGEN).map((eintrag) => pfad.e164Endung(eintrag.e164));
  assert.equal(
    logger.text(),
    `[el-trunk] sweep fertig scope=allowlist aktiv=${anzahl} belegt=0 repariert=0 abweichung=0 unbekannt=0 ohne_registrierung=${anzahl} ` +
      `ohne_beleg_endungen=${sichtbar.join(",")},+${KAPPUNG_UEBERHANG}`,
  );
  assert.ok(logger.text().includes("…0110,+2"), "Positiv-Kontrolle: zehnte Endung ist …0110");
});

test("IEX-A8-11: BELEGT setzt, ABWEICHUNG loescht, UNBEKANNT laesst stehen, nicht aktiv/ohne Registrierung ohne GET", async () => {
  const fpAlt = "fp_alt_bleibt";
  const numbers = [
    nummer({ index: 1 }),
    nummer({ index: 2, elInboundTrunkBelegtAt: T1_ISO, elInboundTrunkZugangFp: fpAlt }),
    nummer({ index: 3, elInboundTrunkBelegtAt: T1_ISO, elInboundTrunkZugangFp: fpAlt }),
    nummer({ index: 4, registrierungsId: null }),
    nummer({ index: 5, status: NUMBER_STATUS.SUSPENDED }),
    nummer({ index: 7, status: NUMBER_STATUS.RELEASED }),
  ];
  const store = fakeStore(numbers);
  const elRead = fakeElRead({
    phnum_a8_1: () => passendeRegistrierung(didFuer(1)),
    phnum_a8_2: () => Promise.reject(anbieterFehler(HTTP_NOT_FOUND)),
    phnum_a8_3: () => Promise.reject(anbieterFehler(HTTP_TOO_MANY)),
  });
  const { logger, laeuft } = lauf({ store, elRead });
  await laeuft;

  const [belegt, abweichung, unbekannt] = store.state.numbers;
  assert.equal(belegt.elInboundTrunkBelegtAt, T0_ISO);
  assert.equal(belegt.elInboundTrunkZugangFp, pfad.zugangsFingerabdruck(SIP_USER));
  assert.equal("elInboundTrunkBelegtAt" in abweichung, false);
  assert.equal("elInboundTrunkZugangFp" in abweichung, false);
  assert.equal(unbekannt.elInboundTrunkBelegtAt, T1_ISO);
  assert.equal(unbekannt.elInboundTrunkZugangFp, fpAlt);
  assert.deepEqual([...elRead.abrufe].sort(), ["phnum_a8_1", "phnum_a8_2", "phnum_a8_3"]);
  assert.match(logger.text(), / aktiv=4 belegt=1 repariert=0 abweichung=1 unbekannt=1 ohne_registrierung=1 /);
});

function verzoegerterElRead() {
  const offen = { jetzt: 0, max: 0 };
  const zurueckgehalten = [];
  return {
    offen,
    zurueckgehalten,
    fetchPhoneNumber: (phoneNumberId) =>
      new Promise((resolve) => {
        offen.jetzt += 1;
        offen.max = Math.max(offen.max, offen.jetzt);
        zurueckgehalten.push({
          phoneNumberId,
          freigeben: () => {
            offen.jetzt -= 1;
            resolve(passendeRegistrierung(didFuer(Number(phoneNumberId.split("_").pop()))));
          },
          freigegeben: false,
        });
      }),
  };
}

async function eventLoopDurchlauf() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("IEX-A8-12: hoechstens SWEEP_PARALLEL GETs offen, Ergebniszeile erst nach dem LETZTEN GET", async () => {
  const letzteId = `phnum_a8_${ZEIT_ANZAHL}`;
  const numbers = Array.from({ length: ZEIT_ANZAHL }, (_leer, versatz) => nummer({ index: versatz + 1 }));
  const elRead = verzoegerterElRead();
  const { logger, laeuft } = lauf({ store: fakeStore(numbers), elRead });

  for (let runde = 0; runde < MAX_FLUSH_RUNDEN; runde += 1) {
    await eventLoopDurchlauf();
    for (const eintrag of elRead.zurueckgehalten.filter((kandidat) => !kandidat.freigegeben)) {
      if (eintrag.phoneNumberId === letzteId) continue;
      eintrag.freigegeben = true;
      eintrag.freigeben();
    }
    if (elRead.zurueckgehalten.some((eintrag) => eintrag.phoneNumberId === letzteId)) break;
  }
  await eventLoopDurchlauf();
  assert.equal(elRead.offen.max, beleg.SWEEP_PARALLEL, "Positiv-Kontrolle: die Grenze wird ausgeschoepft, nie ueberschritten");
  assert.equal(elRead.zurueckgehalten.length, ZEIT_ANZAHL);
  assert.equal(logger.text().includes("sweep fertig"), false, "vor dem letzten GET keine Ergebniszeile");

  elRead.zurueckgehalten.find((eintrag) => eintrag.phoneNumberId === letzteId).freigeben();
  await laeuft;
  const fertigZeilen = logger.zeilen.filter((eintrag) => eintrag.zeile.includes("sweep fertig"));
  assert.equal(fertigZeilen.length, 1);
});

test("IEX-A8-13: Hindernis -> genau die Uebersprungen-Zeile, kein GET, keine Store-Mutation", async () => {
  const store = fakeStore([nummer({ index: 1 })]);
  const elRead = fakeElRead({ phnum_a8_1: () => passendeRegistrierung(didFuer(1)) });
  const { logger, laeuft } = lauf({ store, elRead, config: sweepConfig({ enabled: false }) });
  await laeuft;
  assert.deepEqual(logger.zeilen, [{ stufe: "log", zeile: "[el-trunk] sweep uebersprungen grund=schalter_aus" }]);
  assert.equal(elRead.abrufe.length, 0);
  assert.deepEqual(store.aufrufe, { mark: 0, clear: 0 });
});

function wirftGeheim() {
  throw new Error(GEHEIMER_FEHLERTEXT);
}

const WURF_FAELLE = [
  ["store.load wirft", { load: wirftGeheim }],
  ["store.markNumberElInboundTrunkBelegt wirft", { markNumberElInboundTrunkBelegt: wirftGeheim }],
];

for (const [label, sabotage] of WURF_FAELLE) {
  test(`IEX-A8-14: ${label} -> runBootSweep resolved, genau "sweep fehler", kein Fehlertext`, async () => {
    const store = fakeStore([nummer({ index: 1 })], sabotage);
    const elRead = fakeElRead({ phnum_a8_1: () => passendeRegistrierung(didFuer(1)) });
    const { logger, laeuft } = lauf({ store, elRead });
    await assert.doesNotReject(laeuft);
    assert.deepEqual(logger.zeilen, [{ stufe: "error", zeile: "[el-trunk] sweep fehler" }]);
    assert.equal(logger.text().includes(GEHEIMER_FEHLERTEXT), false);
  });
}

test("IEX-A8-15: Log-Hygiene ueber einen Voll-Lauf - kein sipUser, kein Fingerabdruck, keine Nummer, keine Id", async () => {
  const { numbers, elRead } = mischfall();
  const { logger, laeuft } = lauf({ store: fakeStore(numbers), elRead });
  await laeuft;
  const text = logger.text();
  assert.ok(text.includes("sweep fertig"), "Positiv-Kontrolle: der Lauf hat geloggt");
  assert.equal(text.includes(SIP_USER), false);
  assert.equal(text.includes(pfad.zugangsFingerabdruck(SIP_USER)), false);
  for (const eintrag of numbers) assert.equal(text.includes(eintrag.e164), false, "keine volle e164");
  assert.equal(text.includes("phnum_"), false);
  assert.equal(text.includes("num_"), false);
});

test("IEX-A8-16: inboundElAllowlistProbeLine ist mit und ohne Beleg-Felder byte-gleich und nennt keine Beleg-Zahlen", () => {
  const ohne = { numbers: [nummer({ index: 1 })] };
  const mit = { numbers: [nummer({ index: 1, elInboundTrunkBelegtAt: T0_ISO, elInboundTrunkZugangFp: "fp" })] };
  const tenantIds = ["tenant_a8"];
  const zeileOhne = pfad.inboundElAllowlistProbeLine({ state: ohne, tenantIds });
  const zeileMit = pfad.inboundElAllowlistProbeLine({ state: mit, tenantIds });
  assert.equal(zeileMit, zeileOhne);
  assert.ok(zeileMit.includes("…0001"), "Positiv-Kontrolle: die Sonde sieht die Nummer");
  for (const wort of ["belegt", "abweichung", "unbekannt"]) assert.equal(zeileMit.includes(wort), false, wort);
});

test("IEX-A8-18: server.js baut den Sweep und reicht ihn durch, boot.js ruft ihn nach logBootBanner", () => {
  const serverSrc = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
  const bootSrc = fs.readFileSync(path.join(ROOT, "src", "boot.js"), "utf8");
  assert.match(
    serverSrc,
    /const inboundTrunkSweep = makeTrunkSweep\(\{ store, config, elRead, reparatur: inboundTrunkSchreiberWennErlaubt\(config\) \}\)/,
  );
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsBlock = serverSrc.slice(depsStart, serverSrc.indexOf("};", depsStart));
  assert.match(depsBlock, /\binboundTrunkSweep,/);
  assert.match(bootSrc, /export async function bootServer\(\{[^]*?\binboundTrunkSweep,[^]*?\}\)/);
  const listenStart = bootSrc.indexOf("app.listen(");
  const bannerIndex = bootSrc.indexOf("logBootBanner(config, port", listenStart);
  const sweepIndex = bootSrc.indexOf("inboundTrunkSweep.runBootSweep()", listenStart);
  assert.notEqual(listenStart, -1);
  assert.notEqual(bannerIndex, -1);
  assert.ok(sweepIndex > bannerIndex, "runBootSweep steht im listen-Callback NACH logBootBanner");
});

async function startFakeEl(body) {
  const zurueckgehalten = [];
  const empfangen = { anzahl: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/convai/phone-numbers/phnum_a8") {
      empfangen.anzahl += 1;
      zurueckgehalten.push(res);
      return;
    }
    res.writeHead(HTTP_NOT_FOUND).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    basis: `http://127.0.0.1:${server.address().port}`,
    empfangen,
    freigeben() {
      for (const res of zurueckgehalten.splice(0)) {
        res.writeHead(HTTP_OK, { "content-type": "application/json" }).end(JSON.stringify(body));
      }
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function warteBis(pruefung, timeoutMs) {
  const frist = Date.now() + timeoutMs;
  while (!pruefung()) {
    if (Date.now() > frist) throw new Error("Bedingung nicht erreicht");
    await eventLoopDurchlauf();
  }
}

test("IEX-A8-19: Spawn E2E - Dienst laeuft waehrend des GET, Ergebniszeile und Beleg danach", async () => {
  const sipUser = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER;
  const fakeEl = await startFakeEl({
    phone_number: TELNYX_TEST_TENANT_NUMBER,
    assigned_agent: { agent_id: "agent_a8" },
    inbound_trunk: { has_auth_credentials: true, username: sipUser, allowed_numbers: [TELNYX_TEST_TENANT_NUMBER] },
  });
  const seed = seedWithTelnyxNumber();
  seed.numbers[0].providerAgentPhoneNumberId = "phnum_a8";
  let srv;
  try {
    srv = await startServer({
      env: {
        ELEVENLABS_INBOUND_ENABLED: "true",
        ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP,
        ...EL_INBOUND_ACCESS_BOOT_ENV,
        ELEVENLABS_API_KEY: "test",
        ELEVENLABS_API_BASE: fakeEl.basis,
        ELEVENLABS_AGENT_ID: "agent_a8",
      },
      seed,
    });
    await warteBis(() => fakeEl.empfangen.anzahl > 0, E2E_TIMEOUT_MS);
    const health = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(health.status, HTTP_OK, "Dienst antwortet, waehrend der Anbieter-GET haengt");
    assert.equal(srv.stdout.includes("sweep fertig"), false);

    fakeEl.freigeben();
    await waitForLog(
      srv,
      /\[el-trunk\] sweep fertig scope=allowlist aktiv=1 belegt=1 repariert=0 abweichung=0 unbekannt=0 ohne_registrierung=0/,
      E2E_TIMEOUT_MS,
    );
    const gespeichert = srv.readStore().numbers.find((eintrag) => eintrag.id === "num_telnyx");
    const fp = pfad.zugangsFingerabdruck(sipUser);
    assert.equal(gespeichert.elInboundTrunkZugangFp, fp);
    assert.equal(srv.stdout.includes(sipUser), false);
    assert.equal(srv.stdout.includes(fp), false);
    assert.equal(srv.stdout.includes(TELNYX_TEST_TENANT_NUMBER), false);
  } finally {
    fakeEl.freigeben();
    await srv?.stop();
    await fakeEl.stop();
  }
});
