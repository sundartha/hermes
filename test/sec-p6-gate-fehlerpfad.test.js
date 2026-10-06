import { test, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { tempDataDir, seedState } from "./helpers.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const TENANT = "T";
const VALID_TO = "+491711234567";
const OBJECTIVE = "Termin vereinbaren";
const HTTP_OK = 200;
const HTTP_CLIENT_ERROR = 400;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_FORBIDDEN = 403;
const WURF_MARKER = "interner-datenquellen-defekt";

let makeCallRoutes;
let makeOutboundGates;
let GATE_ERROR_GRUND;
let GATE_ERROR_MESSAGE;

before(async () => {
  process.env.PRECALL_BRIEFING_ENABLED = "false";
  process.env.ASSISTANT_CONTEXT_ENABLED = "false";
  process.env.IN_CALL_CONSULT_ENABLED = "false";
  process.env.CONSULT_ENABLED = "false";
  process.env.METRICS_ENABLED = "false";
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ makeCallRoutes } = await import("../src/routes/api-calls.js"));
  ({ makeOutboundGates, GATE_ERROR_GRUND, GATE_ERROR_MESSAGE } = await import(
    "../src/telephony/outbound-gates.js"
  ));
});

function kettenStore(overrides = {}) {
  return {
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
    load: () => ({
      numbers: [{ tenantId: TENANT, status: "active", provider: "telnyx", e164: "+491700000000" }],
    }),
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
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: () => true,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    reserveExceedsBudget: () => true,
    claimPlatformSpendWarning: () => null,
    resolveCallLanguage: () => "de",
    activeCallsFor: () => [],
    releaseOutboundReserveCents: () => true,
    createCall: (felder) => ({ id: "call_secp6", ...felder }),
    recordCostProfile: () => {},
    save: () => {},
    ...overrides,
  };
}

function zaehlenderStore(basis, werfendeQuelle = null) {
  const aufrufe = new Map();
  const store = {};
  for (const [name, fn] of Object.entries(basis)) {
    store[name] = (...args) => {
      aufrufe.set(name, (aufrufe.get(name) || 0) + 1);
      if (name === werfendeQuelle) throw new Error(`${WURF_MARKER} quelle=${name}`);
      return fn(...args);
    };
  }
  return { store, aufrufe };
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
    elevenLabsOutbound: { enabled: false },
    telnyxAssistant: { enabled: false },
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
    ...overrides,
  });
}

async function postCall({ store, aufrufe, config, audit = () => {} }) {
  let wahlversuche = 0;
  const zaehleWahl = () => {
    wahlversuche += 1;
    return { sid: "sid_secp6" };
  };
  const { gates: outboundGates, callQuotaDenial } = makeOutboundGates({
    store,
    config,
    requestTenant: () => TENANT,
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
    audit,
  });
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      config,
      audit,
      outboundGates,
      callQuotaDenial,
      voiceControl: () => ({ originateCall: async () => zaehleWahl() }),
      originateElevenLabsCall: async () => zaehleWahl(),
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
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: VALID_TO, objective: OBJECTIVE }),
    });
    return { status: res.status, body: await res.json(), wahlversuche, aufrufe };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const VARIANTE = Object.freeze({
  STANDARD: "standard",
  EINGESCHRAENKT: "eingeschraenkt",
  BEZAHLPFLICHTIG: "bezahlpflichtig",
  RESERVE_SCHEITERT: "reserve_scheitert",
});

const VARIANTEN = Object.freeze({
  [VARIANTE.STANDARD]: { store: {}, config: {} },
  [VARIANTE.EINGESCHRAENKT]: {
    store: {
      resolveProfile: () => ({
        unrestricted: false,
        allowedCountryCodes: null,
        maxCallsPerHour: null,
        allowedNumbers: [],
        allowConsult: false,
        allowLookup: false,
      }),
    },
    config: {},
  },
  [VARIANTE.BEZAHLPFLICHTIG]: { store: {}, config: { paymentEnabled: true } },
  [VARIANTE.RESERVE_SCHEITERT]: {
    store: { tryReserveOutboundBudget: () => false },
    config: {},
  },
});

const KETTEN_QUELLEN = Object.freeze({
  tenantPrivateNumber: VARIANTE.STANDARD,
  load: VARIANTE.STANDARD,
  tenantGeo: VARIANTE.STANDARD,
  kycReached: VARIANTE.STANDARD,
  tenantContext: VARIANTE.STANDARD,
  resolveProfile: VARIANTE.STANDARD,
  countOutboundCallsSince: VARIANTE.STANDARD,
  tenantInactive: VARIANTE.STANDARD,
  billingHoldActive: VARIANTE.STANDARD,
  tenantSubscription: VARIANTE.BEZAHLPFLICHTIG,
  planMinutesExceeded: VARIANTE.BEZAHLPFLICHTIG,
  budgetExceeded: VARIANTE.STANDARD,
  tenantBudgetSnapshot: VARIANTE.STANDARD,
  withStoreLock: VARIANTE.STANDARD,
  tryReserveOutboundBudget: VARIANTE.STANDARD,
  tenantActiveSubscriber: VARIANTE.EINGESCHRAENKT,
  reserveExceedsBudget: VARIANTE.RESERVE_SCHEITERT,
  tenantLanguage: VARIANTE.RESERVE_SCHEITERT,
});

const NICHT_KETTEN_QUELLEN = Object.freeze([
  "claimPlatformSpendWarning",
  "resolveCallLanguage",
  "activeCallsFor",
  "releaseOutboundReserveCents",
  "createCall",
  "recordCostProfile",
  "save",
]);

async function postMitWerfenderQuelle(quelle, variante) {
  const { store: storeOverrides, config: configOverrides } = VARIANTEN[variante];
  const { store, aufrufe } = zaehlenderStore(kettenStore(storeOverrides), quelle);
  return postCall({ store, aufrufe, config: testConfig(configOverrides) });
}

test("SEC-P6-1: Kontrolle - saubere Kette waehlt GENAU EINMAL und antwortet 200", async () => {
  const { store, aufrufe } = zaehlenderStore(kettenStore());
  const ergebnis = await postCall({ store, aufrufe, config: testConfig() });
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(ergebnis.body.ok, true);
  assert.equal(
    ergebnis.wahlversuche,
    1,
    "ohne diese Kontrolle waere 'Spion bleibt bei 0' unten wertlos",
  );
});

test("SEC-P6-2: JEDE werfende Datenquelle der Kette -> Status >= 400 UND null Wahlversuche", async () => {
  for (const [quelle, variante] of Object.entries(KETTEN_QUELLEN)) {
    const { status, body, wahlversuche, aufrufe } = await postMitWerfenderQuelle(
      quelle,
      variante,
    );
    assert.ok(
      (aufrufe.get(quelle) || 0) > 0,
      `${quelle} wurde in Variante ${variante} nie gefragt - dieser Fall misst nichts`,
    );
    assert.ok(status >= HTTP_CLIENT_ERROR, `${quelle}: geantwortet wurde mit ${status}`);
    assert.equal(wahlversuche, 0, `${quelle}: es wurde gewaehlt`);
    assert.equal((aufrufe.get("createCall") || 0), 0, `${quelle}: ein Anruf-Datensatz entstand`);
    assert.ok(body.error, `${quelle}: die Antwort nennt keinen Grund`);
  }
});

test("SEC-P6-2b: die Erwartungstabelle deckt den Store vollstaendig ab", () => {
  const bekannt = [...Object.keys(KETTEN_QUELLEN), ...NICHT_KETTEN_QUELLEN].sort();
  assert.deepEqual(
    Object.keys(kettenStore()).sort(),
    bekannt,
    "eine neue Store-Methode MUSS als Gate-Datenquelle eingeordnet oder ausdruecklich " +
      "ausgenommen werden - sonst waechst der Store still an diesem Waechter vorbei",
  );
});

test("SEC-P6-3: ein geworfenes Gate BRICHT AB - spaetere Gates laufen nicht", async () => {
  const { aufrufe, wahlversuche, status } = await postMitWerfenderQuelle(
    "kycReached",
    VARIANTE.STANDARD,
  );
  assert.equal(status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(aufrufe.get("tryReserveOutboundBudget") || 0, 0, "ein spaeteres Gate lief");
  assert.equal(wahlversuche, 0);
});

test("SEC-P6-4: stirbt die Metrik-Dimension (tenantGeo) mit, wird trotzdem geantwortet", async () => {
  const { status, body, wahlversuche } = await postMitWerfenderQuelle(
    "tenantGeo",
    VARIANTE.STANDARD,
  );
  assert.equal(status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(body.error, GATE_ERROR_MESSAGE);
  assert.equal(wahlversuche, 0);
});

test("SEC-P6-5: wirft audit() selbst, wird die Ablehnung trotzdem zugestellt", async () => {
  const { store, aufrufe } = zaehlenderStore(kettenStore({ kycReached: () => false }));
  const { status, body, wahlversuche } = await postCall({
    store,
    aufrufe,
    config: testConfig(),
    audit: () => {
      throw new Error(WURF_MARKER);
    },
  });
  assert.equal(status, HTTP_FORBIDDEN, "die Ablehnung des kyc-Gates bleibt eine 403");
  assert.ok(body.error);
  assert.equal(wahlversuche, 0);
});

test("SEC-P6-6: der Fehlerpfad ist als gate_error auditiert und nennt kein Innenleben", async () => {
  const zeilen = [];
  const { store, aufrufe } = zaehlenderStore(kettenStore(), "budgetExceeded");
  const { status, body } = await postCall({
    store,
    aufrufe,
    config: testConfig(),
    audit: (event, _req, detail) => zeilen.push(`${event} ${detail}`),
  });
  assert.equal(status, HTTP_SERVICE_UNAVAILABLE);
  const zeile = zeilen.find((kandidat) => kandidat.includes(`grund=${GATE_ERROR_GRUND}`));
  assert.ok(zeile, `keine Audit-Zeile mit grund=${GATE_ERROR_GRUND}: ${zeilen.join(" | ")}`);
  assert.ok(zeile.includes("gate=budget"), `die Zeile nennt das gescheiterte Gate nicht: ${zeile}`);
  const antwort = JSON.stringify(body);
  assert.ok(!antwort.includes(WURF_MARKER), "die Antwort traegt die Meldung des Wurfs");
  assert.ok(!antwort.includes("budgetExceeded"), "die Antwort traegt einen internen Namen");
});

test("SEC-P6-6b: eine sterbende Fruehwarnung lehnt NICHT ab (eigener try/catch bleibt)", async () => {
  const { status, wahlversuche } = await postMitWerfenderQuelle(
    "claimPlatformSpendWarning",
    VARIANTE.STANDARD,
  );
  assert.equal(status, HTTP_OK, "eine Warnung darf nie ablehnen");
  assert.equal(wahlversuche, 1);
});
