import assert from "node:assert/strict";
import http from "node:http";
import { before, test } from "node:test";

import express from "express";
import { makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import { LEITUNGSPLATZ_ENTSCHEIDUNG, makePostgresAnrufstartMarker } from "../../src/store.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { EL_OUTBOUND_CONFIG } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannDiAttrappe, vorspannKonfig, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const VON = "+491700006303";
const ZIEL = "+4917112346303";
const HTTP_OK = 200;
const LESE_VERSUCHE = 9;
const WARTE_TAKT_MS = 1000;
const WARTEFRIST_MS = 120 * 1000;
const FRIST_NICHT_LESBAR_MS = 10 * 1000;
const UHR_MS = Date.parse("2026-01-01T00:00:00.000Z");

let makeCallRoutes;

before(async () => {
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

const routenKonfig = () =>
  withConfigNamespaces({
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
    ...vorspannKonfig([TENANT], EL_OUTBOUND_CONFIG),
    telnyxElevenLabs: {},
    telnyxAssistant: { enabled: false },
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
  });

const freieGates = [
  {
    name: "freie-fahrt",
    run: (ctx) => {
      Object.assign(ctx, { tenantId: TENANT, fromNumber: VON, outboundProvider: "telnyx", reserveCents: 60, maxDur: 60, requestedBy: "test" });
      return null;
    },
  },
];

const leitungsplaetze = (vorpruefung) => ({
  pruefenAusgehend: async () => vorpruefung,
  belegenAusgehend: async () => ({ entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.FREI }),
  belegenWartend: async () => LEITUNGSPLATZ_ENTSCHEIDUNG.FREI,
  freigeben: () => {},
});

function routen({ store, attrappe, plaetze, protokoll, anrufstart }) {
  return makeCallRoutes({
    ...attrappe,
    store: Object.assign(Object.create(store), {
      numberRecordByE164: (e164) => ({ e164, tenantId: TENANT, providerAgentPhoneNumberId: "phnum_6303" }),
      load: () => ({ ...store.load(), numbers: [vorspannSeedNummer({ tenantId: TENANT, nummer: VON, registrierung: "phnum_6303" })] }),
    }),
    mitAnrufSperre: undefined,
    leitungsplaetze: plaetze,
    config: routenKonfig(),
    audit: () => {},
    outboundGates: freieGates,
    callQuotaDenial: () => null,
    voiceControl: () => ({ originateCall: async () => ({ sid: "sid_6303" }), endCall: async () => {} }),
    originateElevenLabsCall: async () => {},
    terminateAndBillCall: async ({ persistEnd, bill }) => {
      await persistEnd();
      await bill();
    },
    hangUpAction: () => null,
    billThunk: (_finish, _store, callId) => () => protokoll.abgerechnet.push(callId),
    finishCall: () => {},
    arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
    anrufstart,
    tenant: { requestTenant: () => TENANT, requireTenant: () => TENANT, tenantOwnsCall: () => true },
    consultDelivery: { waitForEvent: async () => ({}) },
    internalIdentity: () => null,
    OWNER_ID: "owner",
  });
}

function lauschen(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = http.createServer(app);
  return new Promise((fertig) => server.listen(0, "127.0.0.1", () => fertig({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const schliessen = (server) => new Promise((fertig) => server.close(fertig));

function stoerbarerRunner(runner) {
  const stoerung = { noch: 0 };
  const haelt = (text) => stoerung.noch > 0 && text.includes("FROM anruf_schluessel WHERE call_id");
  return {
    stoerung,
    runner: {
      withClient: (arbeit) =>
        runner.withClient((client) =>
          arbeit({
            exec: (sql) => client.exec(sql),
            query: (text, werte) => {
              if (!haelt(text)) return client.query(text, werte);
              stoerung.noch -= 1;
              return Promise.reject(new Error("Datenbank antwortet nicht"));
            },
          }),
        ),
    },
  };
}

async function zeileLesen(runner, callId) {
  return runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT]);
    const { rows } = await client.query("SELECT status, failure_reason FROM call WHERE id = $1", [callId]);
    return rows[0];
  });
}

async function zweiInstanzen(t) {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  const { store: instanzA, runner } = await makePgTestStore();
  const { runner: runnerB, stoerung } = stoerbarerRunner(runner);
  const instanzB = makePgStore(runnerB);
  await instanzB.init();
  const protokoll = { abgerechnet: [], gewartet: [], eingereiht: [], handler: null };
  const attrappeB = vorspannDiAttrappe();
  const uhr = { jetztMs: () => UHR_MS, warte: async (ms) => protokoll.gewartet.push(ms) };
  routen({
    store: instanzB,
    attrappe: attrappeB,
    plaetze: leitungsplaetze(LEITUNGSPLATZ_ENTSCHEIDUNG.FREI),
    protokoll,
    anrufstart: {
      uhr,
      macheAuftrag: (verbindung) =>
        makeAnrufstartAuftrag({
          ...verbindung,
          store: Object.assign(Object.create(instanzB), { anrufstartMarker: makePostgresAnrufstartMarker(runnerB) }),
          anbieterGespraeche: { liste: async () => null, hole: async () => null },
          haltAnrufStartFest: () => {},
          beendeStartUnklar: async () => {},
          mandantenToken: () => "token",
          wartefristMs: WARTEFRIST_MS,
        }),
      verdrahtung: { setzeHandler: (handler) => (protokoll.handler = handler) },
    },
  });
  const einreihen = { aufruf: async () => true };
  const wartend = await lauschen(
    routen({
      store: instanzA,
      attrappe: vorspannDiAttrappe(),
      plaetze: leitungsplaetze(LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL),
      protokoll,
      anrufstart: { einreihen: (callId) => einreihen.aufruf(callId) },
    }),
  );
  t.after(() => schliessen(wartend.server));
  const post = async () => {
    const antwort = await abrufMitFrist(`${wartend.url}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren" }),
    });
    return { status: antwort.status, body: await antwort.json() };
  };
  return { instanzB, runner, stoerung, protokoll, attrappeB, einreihen, post };
}

test("Anrufstart Queue-Pfad: ist die Antwort 200 da, liest eine zweite Instanz die Zeile aktiv und nicht leer", async (t) => {
  const { instanzB, einreihen, post } = await zweiInstanzen(t);
  const gelesen = [];
  einreihen.aufruf = async (callId) => {
    gelesen.push(await instanzB.leseCall(callId));
    return true;
  };
  const antwort = await post();
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(gelesen.length, 1);
  assert.ok(gelesen[0], "die Zeile ist beim Einreihen schon lesbar");
  assert.equal(gelesen[0].id, antwort.body.callId);
  assert.equal(gelesen[0].status, "active");
});

test("Anrufstart Queue-Pfad: scheitert das Lesen der Anrufzeile zweimal, wartet der Auftrag und startet genau einmal", async (t) => {
  const { stoerung, protokoll, attrappeB, post } = await zweiInstanzen(t);
  const { body } = await post();
  stoerung.noch = 2;
  assert.equal(await protokoll.handler({ payload: { callId: body.callId } }), "gestartet");
  assert.deepEqual(attrappeB.gewaehlt, [body.callId]);
  assert.deepEqual(protokoll.gewartet, [WARTE_TAKT_MS, WARTE_TAKT_MS]);
  assert.deepEqual(protokoll.abgerechnet, []);
});

test("Anrufstart Queue-Pfad: bleibt das Lesen der Anrufzeile unmoeglich, endet der Anruf in der Datenbank ohne Wahl und mit freier Reserve", async (t) => {
  const { runner, stoerung, protokoll, attrappeB, post } = await zweiInstanzen(t);
  const { body } = await post();
  stoerung.noch = LESE_VERSUCHE;
  await assert.rejects(protokoll.handler({ payload: { callId: body.callId } }), /Datenbank antwortet nicht/);
  assert.deepEqual(attrappeB.gewaehlt, []);
  assert.deepEqual(await zeileLesen(runner, body.callId), { status: "failed", failure_reason: "not-placed:anruf-nicht-lesbar" });
  assert.deepEqual(protokoll.abgerechnet, [body.callId]);
  assert.deepEqual(protokoll.gewartet, Array(LESE_VERSUCHE - 1).fill(WARTE_TAKT_MS));
  assert.ok(protokoll.gewartet.reduce((summe, ms) => summe + ms, 0) <= FRIST_NICHT_LESBAR_MS);
});

test("Anrufstart Queue-Pfad: ein Auftrag mit unbekannter callId wirft, waehlt nicht und legt keine Zeile an", async (t) => {
  const { runner, protokoll, attrappeB } = await zweiInstanzen(t);
  await assert.rejects(protokoll.handler({ payload: { callId: "call_unbekannt_6303" } }), /Auftrag ohne bekannten Anruf/);
  assert.deepEqual(attrappeB.gewaehlt, []);
  assert.equal(await zeileLesen(runner, "call_unbekannt_6303"), undefined);
});
