import assert from "node:assert/strict";
import http from "node:http";
import { before, test } from "node:test";

import express from "express";
import { config as globaleKonfig } from "../../src/config.ts";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import {
  ELEVENLABS_INIT_PATH,
  INIT_TOKEN_HEADER,
  makeElevenLabsInitWebhookRoutes,
} from "../../src/routes/webhooks-elevenlabs-init.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { EL_OUTBOUND_CONFIG } from "../helpers.js";
import { macheSpeicherSperre } from "../../src/store/pg.js";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannDiAttrappe, vorspannKonfig, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const VON = "+491700006303";
const ZIEL = "+4917112346303";
const HTTP_OK = 200;
const AGENT_ID = "agent_6303";
const INIT_TOKEN = "i".repeat(32);
const ANGENOMMEN_ISO = new Date("2026-01-01T00:00:00.000Z").toISOString();
const KONVERSATION = "conv_6303_init";

globaleKonfig.voice.elevenLabsInbound.initWebhookToken = INIT_TOKEN;
globaleKonfig.voice.elevenLabsOutbound.agentId = AGENT_ID;

let makeCallRoutes;
let zustandsFunktionen;

before(async () => {
  ({ zustandsFunktionen } = await import("../../src/store.js"));
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
      Object.assign(ctx, {
        tenantId: TENANT,
        fromNumber: VON,
        outboundProvider: "telnyx",
        reserveCents: 60,
        maxDur: 60,
        requestedBy: "test",
      });
      return null;
    },
  },
];

function runnerMitGehaltenemFlush(runner) {
  const zustand = { halten: false };
  const tor = new Promise((fertig) => {
    zustand.freigeben = fertig;
  });
  const begonnen = new Promise((fertig) => {
    zustand.melde = fertig;
  });
  return {
    runner: {
      withClient: async (arbeit) => {
        if (!zustand.halten) return runner.withClient(arbeit);
        zustand.halten = false;
        zustand.melde();
        await tor;
        return runner.withClient(arbeit);
      },
    },
    haltenAb: () => {
      zustand.halten = true;
    },
    begonnen,
    freigeben: () => zustand.freigeben(),
  };
}

function lauschen(app) {
  const server = http.createServer(app);
  return new Promise((fertig) => server.listen(0, "127.0.0.1", () => fertig({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const schliessen = (server) => new Promise((fertig) => server.close(fertig));

function anrufApp({ store, gehalten }) {
  const diAttrappe = vorspannDiAttrappe();
  const waehle = diAttrappe.vorspannAblauf.waehle;
  diAttrappe.vorspannAblauf.waehle = async (angaben) => {
    gehalten.haltenAb();
    return waehle(angaben);
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...diAttrappe,
      store: Object.assign(Object.create(store), {
        numberRecordByE164: (e164) => ({ e164, tenantId: TENANT, providerAgentPhoneNumberId: "phnum_6303" }),
        load: () => ({ ...store.load(), numbers: [vorspannSeedNummer({ tenantId: TENANT, nummer: VON, registrierung: "phnum_6303" })] }),
      }),
      mitAnrufSperre: undefined,
      leitungsplaetze: {
        pruefenAusgehend: async () => "frei",
        belegenAusgehend: async () => ({ entscheidung: "frei" }),
        belegenWartend: async () => "frei",
        freigeben: () => {},
      },
      config: routenKonfig(),
      audit: () => {},
      outboundGates: freieGates,
      callQuotaDenial: () => null,
      voiceControl: () => ({ originateCall: async () => ({ sid: "sid_6303" }), endCall: async () => {} }),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => TENANT, requireTenant: () => TENANT, tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  return app;
}

function initApp(store) {
  const app = express();
  app.use(express.json());
  app.use(
    makeElevenLabsInitWebhookRoutes({
      store,
      config: globaleKonfig,
      bridges: { clearDeadlines: () => {} },
      outboundInitInhalt: () => ({ marke: "6303" }),
      vorspannText: () => "",
    }),
  );
  return app;
}

async function zeileLesen(runner, callId) {
  return runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT]);
    const { rows } = await client.query("SELECT status, elevenlabs_conversation_id FROM call WHERE id = $1", [callId]);
    return rows[0];
  });
}

test("POST /api/calls: Ein Flush nach dem Start loescht die vom Init gebundene Konversation in der Zeile call nicht", async () => {
  const { runner } = await makePgTestStore();
  const gehalten = runnerMitGehaltenemFlush(runner);
  const instanzA = makePgStore(gehalten.runner);
  instanzA.withStoreLock = macheSpeicherSperre();
  Object.assign(instanzA, zustandsFunktionen(instanzA));
  await instanzA.init();
  const instanzB = makePgStore(runner);
  await instanzB.init();
  const anruf = await lauschen(anrufApp({ store: instanzA, gehalten }));
  const init = await lauschen(initApp(instanzB));
  try {
    const antwort = await abrufMitFrist(`${anruf.url}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren" }),
    });
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    await gehalten.begonnen;
    assert.ok(instanzB.getCall(callId) ?? (await instanzB.attachActiveCall(callId)));
    instanzB.getCall(callId).answeredAt = ANGENOMMEN_ISO;
    await instanzB.persistCall(callId);
    const bindungsToken = instanzB.getCall(callId).streamToken;
    const bindung = await abrufMitFrist(`${init.url}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
      body: JSON.stringify({
        agent_id: AGENT_ID,
        conversation_id: KONVERSATION,
        called_number: VON,
        sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: bindungsToken },
      }),
    });
    assert.equal(bindung.status, HTTP_OK, await bindung.text());
    gehalten.freigeben();
    await instanzA.drainFlushes();
    await instanzB.drainFlushes();
    assert.deepEqual(await zeileLesen(runner, callId), { status: "active", elevenlabs_conversation_id: KONVERSATION });
  } finally {
    gehalten.freigeben();
    await schliessen(anruf.server);
    await schliessen(init.server);
  }
});
