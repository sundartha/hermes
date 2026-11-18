import { LEITUNGSPLATZ_ENTSCHEIDUNG } from "../../src/store.js";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { schalteNebenkanaeleAb, tempDataDir, seedState, EL_OUTBOUND_CONFIG } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitSperreGelesen } from "../gemeinsam/sperre-gelesen-attrappe.js";
import { vorspannDiAttrappe, vorspannKonfig, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "T";
const VALID_TO = "+491711234567";
const HTTP_OK = 200;

let makeCallRoutes;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

async function baueStore(protokoll) {
  const { store: echt } = await makePgTestStore();
  const basis = {
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
    load: () => ({
      numbers: [vorspannSeedNummer({ tenantId: TENANT, nummer: "+491700000000", registrierung: "phnum_einr" })],
    }),
    numberRecordByE164: (e164) => ({ e164, tenantId: TENANT, providerAgentPhoneNumberId: "phnum_einr" }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice", settings: { allowResearch: false } }),
    resolveProfile: () => ({
      unrestricted: true,
      allowedCountryCodes: null,
      maxCallsPerHour: null,
      allowedNumbers: [],
      allowConsult: false,
      allowLookup: false,
    }),
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    tryReserveOutboundBudget: () => true,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    reserveExceedsBudget: () => true,
    claimPlatformSpendWarning: () => null,
    resolveCallLanguage: () => "de",
    activeCallsFor: () => [],
    activeCallsForSql: async () => [],
    releaseOutboundReserveCents: () => true,
    persistCall: async () => {},
    createCall: (felder) => {
      const angelegt = { ...felder };
      protokoll.angelegt.push(angelegt);
      return angelegt;
    },
    recordCostProfile: () => {},
    recordFailureReason: (callId, grund) => protokoll.gruende.push([callId, grund]),
    endCallRecord: (callId, status) => protokoll.enden.push([callId, status]),
    save: () => {},
  };
  return mitSperreGelesen(Object.assign(echt, basis));
}

function konfig() {
  return withConfigNamespaces({
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
    telnyxAssistant: { enabled: false },
    telnyxElevenLabs: {},
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
  });
}

const KONTEXT = Object.freeze({
  tenantId: TENANT,
  requestedBy: "owner",
  fromNumber: "+491700000000",
  outboundProvider: "telnyx",
  numberRecord: { e164: "+491700000000", tenantId: TENANT, providerAgentPhoneNumberId: "phnum_einr" },
  maxDur: 300,
  reserveCents: 100,
  context: null,
});

const VOLLE_PLATTFORM = Object.freeze({
  pruefenAusgehend: async () => LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL,
  belegenAusgehend: async () => ({ entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL }),
  freigeben: () => {},
});

async function postBeiVollerPlattform({ anrufstart, vorbereitung = () => {} }) {
  const protokoll = { angelegt: [], gruende: [], enden: [], abgerechnet: [] };
  const store = await baueStore(protokoll);
  const config = konfig();
  const attrappe = vorspannDiAttrappe();
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...attrappe,
      store,
      leitungsplaetze: VOLLE_PLATTFORM,
      config,
      audit: () => {},
      outboundGates: [{ name: "kontext", run: (ctx) => Object.assign(ctx, KONTEXT) && null }],
      callQuotaDenial: async () => null,
      voiceControl: () => ({}),
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
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: VALID_TO, objective: "Termin vereinbaren" }),
    });
    const ergebnis = { status: res.status, body: await res.json(), wahlversuche: attrappe.gewaehlt.length, protokoll, config, store, attrappe };
    await vorbereitung(ergebnis);
    return ergebnis;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Wartender Anruf: ist der Anruf beim Wählen aus dem Speicher verschwunden, endet der Start ohne Fehler und setzt keine Verbindungskennung", async (t) => {
  t.mock.method(console, "log", () => {});
  let auftrag;
  const ergebnis = await postBeiVollerPlattform({
    anrufstart: {
      einreihen: async () => true,
      macheAuftrag: (abhaengigkeiten) => abhaengigkeiten,
      verdrahtung: { setzeHandler: (abhaengigkeiten) => (auftrag = abhaengigkeiten) },
    },
  });
  assert.equal(ergebnis.status, HTTP_OK);
  const [angelegt] = ergebnis.protokoll.angelegt;
  ergebnis.store.leseCall = async () => null;
  await auftrag.starte(angelegt);
  assert.deepEqual(ergebnis.attrappe.gewaehlt, [angelegt.id]);
  assert.equal("callControlId" in angelegt, false);
});
