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
const HTTP_SERVICE_UNAVAILABLE = 503;
const FROM = "+491700000000";

let makeCallRoutes;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

async function baueStore(protokoll, sprache) {
  const { store: echt } = await makePgTestStore();
  const nummer = (e164) => ({ e164, tenantId: TENANT, providerAgentPhoneNumberId: "phnum_einr" });
  const frei = { unrestricted: true, allowedCountryCodes: null, maxCallsPerHour: null, allowedNumbers: [], allowConsult: false, allowLookup: false };
  const basis = {
    tenantLanguage: () => sprache,
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE", defaultLanguage: sprache }),
    load: () => ({ numbers: [vorspannSeedNummer({ tenantId: TENANT, nummer: FROM, registrierung: "phnum_einr" })] }),
    numberRecordByE164: nummer,
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice", settings: { allowResearch: false } }),
    resolveProfile: () => frei,
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
    activeCallsFor: () => [],
    activeCallsForSql: async () => [],
    releaseOutboundReserveCents: () => true,
    persistCall: async () => {},
    createCall: (felder) => {
      protokoll.angelegt.push({ ...felder });
      return protokoll.angelegt.at(-1);
    },
    recordCostProfile: () => {},
    leseCall: async (id) => protokoll.angelegt.find((call) => call.id === id) ?? null,
    getCall: (id) => protokoll.angelegt.find((call) => call.id === id) ?? null,
    anrufpauseAktiv: () => false,
    recordFailureReason: (callId, grund) => protokoll.gruende.push([callId, grund]),
    endCallRecord: () => {},
    save: () => {},
  };
  return mitSperreGelesen(Object.assign(echt, basis));
}

async function postBeiVollerPlattformOhneWarteschlange(sprache) {
  const protokoll = { angelegt: [], gruende: [] };
  const attrappe = vorspannDiAttrappe();
  const voll = LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL;
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...attrappe,
      store: await baueStore(protokoll, sprache),
      leitungsplaetze: {
        pruefenAusgehend: async () => voll,
        belegenAusgehend: async () => ({ entscheidung: voll }),
        belegenWartend: async () => LEITUNGSPLATZ_ENTSCHEIDUNG.FREI,
        freigeben: () => {},
      },
      config: withConfigNamespaces({
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
      }),
      audit: () => {},
      outboundGates: [
        {
          name: "kontext",
          run: (ctx) =>
            Object.assign(ctx, {
              tenantId: TENANT,
              requestedBy: "owner",
              fromNumber: FROM,
              outboundProvider: "telnyx",
              numberRecord: nummerRecord(),
              maxDur: 300,
              reserveCents: 100,
              context: null,
            }) && null,
        },
      ],
      callQuotaDenial: async () => null,
      voiceControl: () => ({}),
      terminateAndBillCall: async ({ persistEnd, bill }) => {
        await persistEnd();
        await bill();
      },
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      anrufstart: { einreihen: async () => false },
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
      body: JSON.stringify({ to: "+491711234567", objective: "Termin vereinbaren" }),
    });
    return { status: res.status, body: await res.json(), wahlversuche: attrappe.gewaehlt.length, protokoll };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function nummerRecord() {
  return { e164: FROM, tenantId: TENANT, providerAgentPhoneNumberId: "phnum_einr" };
}

const ERWARTET = [
  ["Warteschlange nicht erreichbar, Tenant en: englischer Text ohne Wahl und ohne Kosten", "en", "The call could not be created. No call was dialled and you will not be charged."],
  ["Warteschlange nicht erreichbar, Tenant fr: franzoesischer Text ohne Wahl und ohne Kosten", "fr", "L'appel n'a pas pu être créé. Aucun numéro n'a été composé et aucun frais ne sera facturé."],
  ["Warteschlange nicht erreichbar, Tenant de: deutscher Text bleibt wortgleich", "de", "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten."],
];

for (const [name, sprache, text] of ERWARTET)
  test(name, async (t) => {
    t.mock.method(console, "error", () => {});
    const ergebnis = await postBeiVollerPlattformOhneWarteschlange(sprache);
    assert.equal(ergebnis.status, HTTP_SERVICE_UNAVAILABLE);
    assert.equal(ergebnis.body.error, text);
    assert.equal(ergebnis.wahlversuche, 0);
    const [angelegt] = ergebnis.protokoll.angelegt;
    assert.deepEqual(ergebnis.protokoll.gruende, [[angelegt.id, "not-placed:warteschlange"]]);
  });
