import assert from "node:assert/strict";
import test from "node:test";

import express from "express";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeCallRoutes } from "../../src/routes/api-calls.js";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { billThunk, terminateAndBillCall } from "../../src/telephony/call-termination.js";
import { makeMetering } from "../../src/billing/metering.js";
import { makeLeitungsplaetze } from "../../src/store.js";
import { seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const EL_START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const KONVERSATION_PFAD = "/v1/convai/conversations/";
const TELNYX_START_PFAD = "/v2/texml/calls/";
const TELNYX_ENV = Object.freeze({
  TELNYX_API_KEY: "KEYtest-su-schluessel",
  TELNYX_CONNECTION_ID: "conn_su",
  TELNYX_ACCOUNT_SID: "acct_su",
});
const TELNYX_PLAETZE = 90;
const ANRUFE_PRO_KUNDE = 2;
const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_su",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_su",
  ELEVENLABS_API_KEY: "el-su-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

const kundeVon = (index) => `t_su_${index}`;
const zielVon = (nummer) => `+1202555${String(6000 + nummer).padStart(4, "0")}`;

function seedKunden(anzahl) {
  const indizes = Array.from({ length: anzahl }, (_, index) => index);
  return seedState({
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: "en",
    })),
    numbers: indizes.map((index) => ({
      id: `num_su_${index}`,
      e164: `+1202555${String(3000 + index).padStart(4, "0")}`,
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_su_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

function starteAnbieter({ startPfad, startNummerMitFehler, scheitertMit, erfolg }) {
  let starts = 0;
  return starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      if (!req.url.startsWith(startPfad)) {
        res.writeHead(HTTP_OK, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...CONVERSATION_IN_PROGRESS, conversation_id: req.url.slice(KONVERSATION_PFAD.length) }));
        return;
      }
      starts += 1;
      if (starts === startNummerMitFehler) {
        if (scheitertMit === null) return req.socket.destroy();
        res.writeHead(scheitertMit);
        return res.end();
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify(erfolg(starts)));
    });
  });
}

async function rufeAn(srv, index, nummer) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: zielVon(nummer), objective: "Tisch reservieren (Startfehler)" }),
  });
  return res.status;
}

const WEGE = [
  {
    name: "ElevenLabs",
    kunden: 4,
    belegt: 3,
    startPfad: EL_START_PFAD,
    erfolg: (nummer) => ({ success: true, conversation_id: `conv_su_${nummer}`, sip_call_id: "sip_su" }),
    env: (url) => ({ ...EL_WEG, ELEVENLABS_API_BASE: url }),
  },
  {
    name: "Telnyx",
    kunden: TELNYX_PLAETZE / ANRUFE_PRO_KUNDE + 1,
    belegt: TELNYX_PLAETZE - 1,
    startPfad: TELNYX_START_PFAD,
    erfolg: (nummer) => ({ sid: `tnx_su_${nummer}` }),
    env: (url) => ({ ...TELNYX_ENV, TELNYX_API_BASE: url }),
  },
];

const FAELLE = [
  { name: "HTTP 500", scheitertMit: 500, antwort: 502, frei: false, grund: "result-unknown:start-500" },
  { name: "Verbindung ohne Antwort abgebrochen", scheitertMit: null, antwort: 500, frei: false, grund: "result-unknown:start-no-status" },
  { name: "HTTP 400", scheitertMit: 400, antwort: 502, frei: true, grund: "not-placed:start-400" },
  { name: "HTTP 422", scheitertMit: 422, antwort: 502, frei: true, grund: "not-placed:start-422" },
  { name: "HTTP 429", scheitertMit: 429, antwort: 502, frei: true, grund: "at-capacity:start-429" },
];

async function belegePlaetze(srv, anzahl) {
  for (let nummer = 1; nummer <= anzahl; nummer += 1)
    assert.equal(await rufeAn(srv, Math.floor((nummer - 1) / ANRUFE_PRO_KUNDE), nummer), HTTP_OK, `Anruf ${nummer}`);
}

for (const weg of WEGE)
  for (const fall of FAELLE) {
    test(`${weg.name}-Startfehler ${fall.name}: Platz ${fall.frei ? "sofort frei" : "bleibt belegt"}, Kundenantwort ${fall.antwort}, Grund ${fall.grund}`, async () => {
      const anbieter = await starteAnbieter({
        startPfad: weg.startPfad,
        startNummerMitFehler: weg.belegt + 1,
        scheitertMit: fall.scheitertMit,
        erfolg: weg.erfolg,
      });
      const srv = await startServer({ env: weg.env(anbieter.url), seed: seedKunden(weg.kunden) });
      try {
        await belegePlaetze(srv, weg.belegt);
        const fehlerNummer = weg.belegt + 1;
        const fehlerKunde = Math.floor(weg.belegt / ANRUFE_PRO_KUNDE);
        assert.equal(await rufeAn(srv, fehlerKunde, fehlerNummer), fall.antwort, "Antwort an den Kunden beim Startfehler");
        const stand = await waitForStoreState(srv, (s) => s.calls.some((call) => call.status === "failed" && Boolean(call.billedAt)));
        assert.deepEqual(stand.calls.filter((call) => call.status === "failed").map((call) => call.failureReason), [fall.grund]);
        assert.equal(await rufeAn(srv, weg.kunden - 1, fehlerNummer + 1), fall.frei ? HTTP_OK : HTTP_UNAVAILABLE);
      } finally {
        await srv.stop();
        await anbieter.close();
      }
    });
  }

const IN_PROZESS_TENANT = "T";
const HOECHSTDAUER_S = 60;
const PUFFER_S = 120;
const ABLAUF_MS = (HOECHSTDAUER_S + PUFFER_S) * 1000;
const START_MS = 1_800_000_000_000;
const LANGE_DAUER_S = 100000;
const NUTZABLE_TELNYX_PLAETZE = 90;
const ZIEL_ERSTER = "+491711234501";
const ZIEL_ZWEITER = "+491711234502";

const inProzessConfig = withConfigNamespaces({
  outboundFrozen: false,
  assistantContextEnabled: false,
  paymentEnabled: false,
  platformSpendCapCents: 800,
  allowedCountryCodes: ["+49"],
  maxCallsPerHour: 100,
  perTargetWindowMs: 3600000,
  perTargetCallCap: 100,
  multiTenant: false,
  diagnosticRetentionDays: 0,
  ownerSelfCallEnabled: false,
  ownerSelfCallTenantIds: [],
  elevenLabsOutbound: { enabled: false },
  telnyxAssistant: { enabled: false },
  voiceEngine: "budget",
  publicUrl: "http://127.0.0.1:1",
});

async function starteInProzess(leitungsplaetze, anbieterFehler) {
  const { store: pgStore } = await makePgTestStore();
  const angelegt = [];
  const store = {
    ...pgStore,
    withStoreLock: async (lauf) => lauf(),
    createCall: (felder) => {
      const anruf = pgStore.createCall(felder);
      angelegt.push(anruf.id);
      return anruf;
    },
  };
  const audit = () => {};
  const { finishCall } = makeCallFinish({
    store,
    config: inProzessConfig,
    metering: makeMetering({ store }),
    messaging: {},
    summarizeCall: async () => null,
    planSummarySms: () => null,
    audit,
    leitungsplaetze,
  });
  const gate = {
    name: "test",
    run(ctx) {
      Object.assign(ctx, {
        tenantId: IN_PROZESS_TENANT,
        fromNumber: "+491700000000",
        outboundProvider: "telnyx",
        reserveCents: 0,
        maxDur: HOECHSTDAUER_S,
        requestedBy: "test",
      });
      return null;
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      leitungsplaetze,
      config: inProzessConfig,
      audit,
      outboundGates: [gate],
      callQuotaDenial: () => null,
      voiceControl: () => ({ originateCall: async () => { throw anbieterFehler; } }),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall,
      hangUpAction: () => null,
      billThunk,
      finishCall,
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => IN_PROZESS_TENANT, requireTenant: () => IN_PROZESS_TENANT, tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((fertig) => {
    const srv = app.listen(0, "127.0.0.1", () => fertig(srv));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/calls`;
  const post = async (to) => {
    const res = await abrufMitFrist(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, objective: "Termin vereinbaren", max_duration_s: HOECHSTDAUER_S }),
    });
    return res.status;
  };
  return { post, angelegt: () => angelegt.map((id) => pgStore.getCall(id)), stop: () => new Promise((fertig) => server.close(fertig)) };
}

const anbieterFehlerMit = (providerStatus) => Object.assign(new Error("Anbieter"), providerStatus === undefined ? {} : { providerStatus });

const ABLAUF_FAELLE = [
  { name: "HTTP 500", fehler: anbieterFehlerMit(500), grund: "result-unknown:start-500" },
  { name: "ohne Statuscode", fehler: anbieterFehlerMit(undefined), grund: "result-unknown:start-no-status" },
];

for (const fall of ABLAUF_FAELLE)
  test(`Startfehler ${fall.name}: der Platz wird bei Hoechstdauer plus 120 s frei, eine Millisekunde davor nicht`, async () => {
    let jetzt = START_MS;
    const leitungsplaetze = makeLeitungsplaetze({ jetztMs: () => jetzt });
    for (let index = 1; index < NUTZABLE_TELNYX_PLAETZE; index += 1)
      await leitungsplaetze.belegenAusgehend({ callId: `vorbelegt_${index}`, weg: "telnyx", maxDauerS: LANGE_DAUER_S });
    const srv = await starteInProzess(leitungsplaetze, fall.fehler);
    try {
      const antwort = await srv.post(ZIEL_ERSTER);
      assert.equal(antwort, fall.fehler.providerStatus ? 502 : 500);
      const [anruf] = srv.angelegt();
      assert.equal(anruf.status, "failed");
      assert.equal(anruf.failureReason, fall.grund);
      jetzt = START_MS + ABLAUF_MS - 1;
      assert.equal(await srv.post(ZIEL_ZWEITER), 503, "eine Millisekunde vor dem Ablauf ist der Platz noch belegt");
      jetzt = START_MS + ABLAUF_MS;
      assert.notEqual(await srv.post(ZIEL_ZWEITER), 503, "zur Ablaufzeit ist der Platz frei");
    } finally {
      await srv.stop();
    }
  });
