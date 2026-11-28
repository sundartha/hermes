import { makeLeitungsplaetze } from "../../src/store.js";
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { schalteNebenkanaeleAb, tempDataDir, seedState, EL_OUTBOUND_CONFIG } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitSperreGelesen } from "../gemeinsam/sperre-gelesen-attrappe.js";
import { vorspannDiAttrappe, vorspannKonfig, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "T";
const VALID_TO = "+491711234567";
const OBJECTIVE = "Termin vereinbaren";
const HTTP_SERVICE_UNAVAILABLE = 503;

let makeCallRoutes;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

function kettenStore() {
  return mitSperreGelesen({
    tenantLanguage: () => "de",
    tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
    load: () => ({
      numbers: [vorspannSeedNummer({ tenantId: TENANT, nummer: "+491700000000", registrierung: "phnum_secp6" })],
    }),
    activeCallsFor: () => [],
    activeCallsForSql: async () => [],
    persistCall: async () => {},
    save: () => {},
  });
}

function testConfig(overrides = {}) {
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
    ...overrides,
  });
}

async function postCall({ store, config, wurf, audit = () => {} }) {
  const attrappe = vorspannDiAttrappe();
  const outboundGates = [{ name: "kyc", run: async () => { throw wurf; } }];
  const callQuotaDenial = () => null;
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...attrappe,
      store,
      leitungsplaetze: makeLeitungsplaetze(),
      config,
      audit,
      outboundGates,
      callQuotaDenial,
      voiceControl: () => ({}),
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: {
        requestTenant: () => TENANT,
        requireTenant: () => TENANT,
        tenantOwnsCall: () => true,
      },
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
      body: JSON.stringify({ to: VALID_TO, objective: OBJECTIVE }),
    });
    return { status: res.status, body: await res.json(), wahlversuche: attrappe.gewaehlt.length };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function mitGateFehler(wurf) {
  const meldungen = mock.method(console, "error", () => {});
  try {
    const ergebnis = await postCall({ store: kettenStore(), config: testConfig(), wurf });
    return { ...ergebnis, aufrufe: meldungen.mock.calls.map((c) => c.arguments) };
  } finally {
    meldungen.mock.restore();
  }
}

test("ein Gate-Fehler wird mit Tor-Name und Fehlertext protokolliert", async () => {
  const { status, aufrufe } = await mitGateFehler(new Error("db weg"));
  assert.equal(status, HTTP_SERVICE_UNAVAILABLE);
  assert.deepEqual(aufrufe, [["[place_call] Gate kyc fehlgeschlagen:", "db weg"]]);
});

test("ein Gate, das undefined wirft, endet trotzdem in der 503-Ablehnung", async () => {
  const { status, wahlversuche, aufrufe } = await mitGateFehler(undefined);
  assert.equal(status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(wahlversuche, 0);
  assert.deepEqual(aufrufe, [["[place_call] Gate kyc fehlgeschlagen:", undefined]]);
});

test("das Erzeugen des Nachweises von aussen wirft einen TypeError", async () => {
  const { GatesBestanden } = await import("../../src/telephony/gates-bestanden.ts");
  assert.throws(() => new GatesBestanden(), { name: "TypeError" });
});
