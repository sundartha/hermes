import assert from "node:assert/strict";
import test from "node:test";

import express from "express";
import { makeLeitungsplaetze } from "../../src/store.js";
import { makeCallRoutes } from "../../src/routes/api-calls.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { seedState, startServer, waitForStoreState, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const AUFTRAG = "Tisch fuer zwei reservieren (EL-Freigabe)";
const EL_PLAETZE_NUTZBAR = 4;
const KUNDEN = EL_PLAETZE_NUTZBAR + 1;
const KOSTENDECKE_CENT = 1000;
const TARIF_CENT = "20";
const WACHE_ENV = Object.freeze({
  DEFAULT_TENANT_BUDGET_CENTS: String(KOSTENDECKE_CENT),
  VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENT,
  VOICE_TARIFF_DEFAULT_CENTS: TARIF_CENT,
  BUDGET_WATCHDOG_INTERVAL_MS: "200",
});
const EL_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_elf",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_elf",
  ELEVENLABS_API_KEY: "el-elf-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

const kundeVon = (index) => `t_elf_${index}`;
const zielVon = (nummer) => `+1202555${String(6000 + nummer).padStart(4, "0")}`;

const RESTBUDGET_CENT = 210;
const LAUFENDER_ANRUF_MS = (9 * 60 + 5) * 1000;

function laufenderAnruf(kunde) {
  const beginn = new Date(Date.now() - LAUFENDER_ANRUF_MS).toISOString();
  return {
    id: "call_elf_laufend",
    direction: "outbound",
    status: "active",
    tenantId: kunde,
    from: "+12025553000",
    to: "+4915112340002",
    goal: "Laufender Anruf (EL-Freigabe)",
    startedAt: beginn,
    answeredAt: beginn,
    maxDurationS: 1800,
  };
}

function seedKunden(verbrauchtJeKunde = {}) {
  const indizes = Array.from({ length: KUNDEN }, (_, index) => index);
  const seed = seedState({
    calls: Object.keys(verbrauchtJeKunde).map((index) => laufenderAnruf(kundeVon(index))),
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: "en",
    })),
    numbers: indizes.map((index) => ({
      id: `num_elf_${index}`,
      e164: `+1202555${String(3000 + index).padStart(4, "0")}`,
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_elf_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
  seed.usage = Object.fromEntries(Object.entries(verbrauchtJeKunde).map(([index, costCents]) => [kundeVon(index), { costCents }]));
  return seed;
}

async function rufeAn(srv, index, nummer) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: zielVon(nummer), objective: AUFTRAG, max_duration_s: 30 }),
  });
  return { status: res.status, body: await res.json() };
}

async function fuelleElPlaetze(srv) {
  for (let index = 0; index < EL_PLAETZE_NUTZBAR; index += 1)
    assert.equal((await rufeAn(srv, index, index + 1)).status, HTTP_OK, `Anruf ${index + 1} muss angenommen werden`);
}

async function assertAusgelastet(srv, nummer) {
  const antwort = await rufeAn(srv, KUNDEN - 1, nummer);
  assert.equal(antwort.status, HTTP_UNAVAILABLE);
  assert.equal(antwort.body.reason, "ausgelastet");
}

async function aufDemElWeg({ env = {}, seed }, lauf) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({ env: { ...EL_ENV, ELEVENLABS_API_BASE: anbieter.url, ...env }, seed });
  try {
    return await lauf({ srv, anbieter });
  } finally {
    await srv.stop();
    await anbieter.schliessen();
  }
}

test("S17: cancel_call bei einem ElevenLabs-Anruf mit laufendem Gespraech gibt den Platz nicht frei", async () => {
  await aufDemElWeg({ seed: seedKunden() }, async ({ srv }) => {
    await fuelleElPlaetze(srv);
    await assertAusgelastet(srv, 900);
    const erster = srv.readStore().calls.find((call) => call.tenantId === kundeVon(0));
    const abbruch = await abrufMitFrist(`${srv.localUrl}/api/calls/${erster.id}/cancel`, {
      method: "POST",
      headers: { "X-Internal-Tenant": erster.tenantId },
    });
    assert.equal(abbruch.status, HTTP_OK);
    const antwort = await abbruch.json();
    assert.equal(antwort.status, "cancelled");
    assert.equal(antwort.line_hangup_confirmed, false);
    await waitForStoreState(srv, (s) => s.calls.find((call) => call.id === erster.id).status === "cancelled");
    await assertAusgelastet(srv, 901);
  });
});

test("S22: das Ende durch die Budget-Wache bei einem ElevenLabs-Anruf gibt den Platz nicht frei", async () => {
  await aufDemElWeg({ env: WACHE_ENV, seed: seedKunden({ 0: KOSTENDECKE_CENT - RESTBUDGET_CENT }) }, async ({ srv, anbieter }) => {
    await fuelleElPlaetze(srv);
    const ersterAuftrag = (s) => s.calls.find((call) => call.tenantId === kundeVon(0) && call.goal === AUFTRAG);
    const beendet = ersterAuftrag(await waitForStoreState(srv, (s) => ersterAuftrag(s).status !== "active", 6000));
    assert.equal(beendet.failureReason, "budget-exhausted");
    await waitUntil(() => anbieter.beendetGespraech(beendet.elevenlabsConversationId), { timeoutMs: 3000 });
    await assertAusgelastet(srv, 902);
  });
});

const START_MS = 1_800_000_000_000;
const SEKUNDE_MS = 1000;
const EL_ABLAUF_S = 600;
const PUFFER_S = 120;
const LANGE_DAUER_S = 1800;
const ABLAUF_MS = (EL_ABLAUF_S + PUFFER_S) * SEKUNDE_MS;

const routenConfig = withConfigNamespaces({
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
  elevenLabsOutbound: { enabled: true },
  telnyxElevenLabs: { voiceId: "voice_elf" },
  telnyxAssistant: { enabled: false },
  voiceEngine: "budget",
  publicUrl: "http://127.0.0.1:1",
});

async function starteElRoute(leitungsplaetze) {
  const { store } = await makePgTestStore();
  const outboundGates = [
    {
      name: "test",
      run(ctx) {
        Object.assign(ctx, {
          tenantId: `T_${ctx.to}`,
          fromNumber: "+491700000000",
          outboundProvider: "telnyx",
          reserveCents: 0,
          maxDur: Number(ctx.b.max_duration_s),
          requestedBy: "test",
        });
        return null;
      },
    },
  ];
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      leitungsplaetze,
      config: routenConfig,
      audit: () => {},
      outboundGates,
      callQuotaDenial: () => null,
      voiceControl: () => ({}),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => "T", requireTenant: () => "T", tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/calls`;
  const post = async (nummer) => {
    const res = await abrufMitFrist(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: `+49171123${String(4000 + nummer)}`, objective: AUFTRAG, max_duration_s: LANGE_DAUER_S }),
    });
    return res.status;
  };
  return { post, stop: () => new Promise((resolve) => server.close(resolve)) };
}

test("S19: der ElevenLabs-Platz eines Anrufs mit max_duration_s 1800 wird nach 600 s plus 120 s frei, nicht erst nach der Hoechstdauer", async () => {
  Object.assign(process.env, {
    PRECALL_BRIEFING_ENABLED: "false",
    ASSISTANT_CONTEXT_ENABLED: "false",
    IN_CALL_CONSULT_ENABLED: "false",
    CONSULT_ENABLED: "false",
    METRICS_ENABLED: "false",
  });
  let jetzt = START_MS;
  const leitungsplaetze = makeLeitungsplaetze({ jetztMs: () => jetzt });
  const route = await starteElRoute(leitungsplaetze);
  try {
    for (let nummer = 1; nummer <= EL_PLAETZE_NUTZBAR; nummer += 1)
      assert.equal(await route.post(nummer), HTTP_OK, `Anruf ${nummer} belegt einen Platz`);
    assert.equal(await route.post(EL_PLAETZE_NUTZBAR + 1), HTTP_UNAVAILABLE, "der fuenfte Anruf findet keinen Platz");
    jetzt = START_MS + ABLAUF_MS - 1;
    assert.equal(await route.post(EL_PLAETZE_NUTZBAR + 2), HTTP_UNAVAILABLE, "eine Millisekunde vor dem Ablauf sind alle Plaetze belegt");
    jetzt = START_MS + ABLAUF_MS;
    for (let nummer = 1; nummer <= EL_PLAETZE_NUTZBAR; nummer += 1)
      assert.equal(await route.post(10 + nummer), HTTP_OK, `zur Ablaufzeit ist Platz ${nummer} frei`);
    assert.equal(await route.post(20), HTTP_UNAVAILABLE, "und genau viermal belegt");
  } finally {
    await route.stop();
  }
});
