// SEC-P6 (GATE-02) - der Fehlerpfad der Outbound-Gate-Kette.
//
// Gemessener Ausgang: 17 von 17 sterbenden Gate-Datenquellen fuehrten zu NULL
// Wahlversuchen (das Sicherheitsversprechen hielt), aber 14 davon zu GAR KEINER Antwort -
// Express 4 faengt Promise-Rejections aus async-Handlern nicht, der Request hing bis zum
// Client-Timeout. Diese Datei pinnt BEIDE Haelften: es wird geantwortet UND es wird nicht
// gewaehlt.
//
// Naht: die ECHTE Gate-Kette (makeOutboundGates) auf der ECHTEN Route (makeCallRoutes),
// montiert auf eine nackte Express-App - Muster test/el-beende-versuch.test.js#postCancel.
// Offline, kein Spawn, keine DB, kein Netz nach draussen (P12 F.I.R.S.T.).
//
// Env VOR dem ersten config-Import, danach dynamische Importe (Muster
// test/al-p10b-lookup.test.js): die Route beruehrt ueber consult/gate.js und
// precall-briefing.js den GLOBALEN config-Snapshot. Ohne dieses Setup entschiede eine
// lokale .env, ob der Briefing-Zweig ein LLM anspricht (Lehre test-base-env-drift).
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/ABNAHME-) am Namensanfang -
// sonst landen sie still im Gates- statt im Regressionslauf (package.json
// config.i18nCatalogPattern, Lehre catalog-id-prefix-misroutes-tests). Praefix ist
// "SEC-P6-<n>:"; ein Waechter, der nicht im Regressionslauf faehrt, friert nichts ein.
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
// Marker im geworfenen Fehler. Er darf im Antwort-Body NIRGENDS auftauchen (Regel 4:
// kein Innenleben an den Client).
const WURF_MARKER = "interner-datenquellen-defekt";

let makeCallRoutes;
let makeOutboundGates;
let GATE_ERROR_GRUND;
let GATE_ERROR_MESSAGE;

before(async () => {
  // Die drei Schalter, die den globalen config-Snapshot dieser Route beruehren: das
  // Pre-Call-Briefing (LLM-Aufruf), der Consult-Kanal und die Metrik-Senke.
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

// ---- Attrappen ------------------------------------------------------------------------

// Attrappe der Ketten-Datenquellen: JEDE Methode, die die Gate-Kette am Store aufruft
// (grep "store\." in telephony/outbound-gates.js), plus die Nachketten-Methoden, ohne die
// die Route nach der Kette nicht bis zum Waehlen kaeme.
//
// BEWUSST LOKAL statt geteilt: dieselbe Idee steht als defaultStore() bereits in
// test/outbound-gates-order.test.js und test/p15-gate-denial-language.test.js. Eine
// gemeinsame Fixtur waere die richtige Aufloesung (G5), schriebe aber zwei Bestandstests
// der Gate-Kette in einer Sicherheitsphase um - das ist ein eigener Refactor, kein
// Nebeneffekt dieses Commits.
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
    // Nachketten-Methoden der Route (RESTRISIKO A, s. PLAN-SECURITY.md): sie sind KEINE
    // Gate-Datenquellen und stehen deshalb in keiner Erwartungstabelle unten - ohne sie
    // erreichte der Gutfall aber nie den Wahlversuch, und die Positiv-Kontrolle waere
    // wertlos.
    resolveCallLanguage: () => "de",
    createCall: (felder) => ({ id: "call_secp6", ...felder }),
    recordCostProfile: () => {},
    save: () => {},
    ...overrides,
  };
}

// Zaehlt JEDEN Zugriff und laesst GENAU EINE Quelle sterben. Der Zaehler ist die
// Voraussetzung der Aussage "diese Quelle wurde ueberhaupt gefragt" - ohne ihn saehe
// "nie gefragt" wie "sauber abgelehnt" aus (Lehre pruefkommando-ohne-positiv-kontrolle).
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

// Baut Kette + Route ueber DEMSELBEN Store und schickt einen echten HTTP-POST. Liefert
// Status, Body, die Zahl der Wahlversuche (drei Spione, Summe) und die Aufruf-Zaehler.
async function postCall({ store, aufrufe, config, audit = () => {} }) {
  let wahlversuche = 0;
  const zaehleWahl = () => {
    wahlversuche += 1;
    return { sid: "sid_secp6" };
  };
  const outboundGates = makeOutboundGates({
    store,
    config,
    requestTenant: () => TENANT,
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
    audit,
  }).gates;
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      config,
      audit,
      outboundGates,
      voiceControl: () => ({ originateCall: async () => zaehleWahl() }),
      originateAiAssistantCall: async () => zaehleWahl(),
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

// ---- Die drei Konfigurations-Varianten -------------------------------------------------
//
// Drei Quellen werden im Gutfall NIE gefragt (die Kette liest sie erst, wenn ein
// bestimmter Zweig laeuft). Sie brauchen deshalb eine eigene Variante - bewusst
// hartkodiert und NICHT "automatisch uebersprungen": eine still uebersprungene Quelle
// waere genau die Luecke, gegen die dieser Test gebaut ist.
const VARIANTE = Object.freeze({
  // Alle Gates passieren, es wird gewaehlt.
  STANDARD: "standard",
  // Kein Admin-Override -> die Abo-Kopplung im allowlistError-Zweig wird gelesen.
  EINGESCHRAENKT: "eingeschraenkt",
  // Zahlungspflicht an -> das Minuten-Kontingent-Gate ist kein No-op mehr.
  BEZAHLPFLICHTIG: "bezahlpflichtig",
  // Reserve schlaegt fehl -> Achsen-Klassifizierung + Ablehnungstext werden gelesen.
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

// Jede Gate-Datenquelle mit der Variante, in der sie tatsaechlich gelesen wird (am Code
// gemessen, im Test unten per aufrufe-Zaehler nachgewiesen).
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

// Die Nachketten-Methoden der Route (RESTRISIKO A) und die Fruehwarnung, die per
// Owner-Invariante NIE ablehnen darf (eigener Fall unten). Zusammen mit KETTEN_QUELLEN
// decken sie den Store vollstaendig ab - der Vollstaendigkeits-Test unten haelt das fest.
const NICHT_KETTEN_QUELLEN = Object.freeze([
  "claimPlatformSpendWarning",
  "resolveCallLanguage",
  "createCall",
  "recordCostProfile",
  "save",
]);

async function postMitWerfenderQuelle(quelle, variante) {
  const { store: storeOverrides, config: configOverrides } = VARIANTEN[variante];
  const { store, aufrufe } = zaehlenderStore(kettenStore(storeOverrides), quelle);
  return postCall({ store, aufrufe, config: testConfig(configOverrides) });
}

// ---- SEC-P6-1: Positiv-Kontrolle -------------------------------------------------------

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

// ---- SEC-P6-2: der Waechter ------------------------------------------------------------

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

// ---- SEC-P6-3: der Abbruch-Riegel ------------------------------------------------------

test("SEC-P6-3: ein geworfenes Gate BRICHT AB - spaetere Gates laufen nicht", async () => {
  // kycReached stirbt im Gate 'kyc' - lange vor 'reserve_budget'. Wuerde der Fehlerpfad
  // die Kette weiterlaufen lassen (continue statt return), wuerde Geld reserviert und
  // am Ende gewaehlt: aus "Gate kaputt" wuerde "es wird gewaehlt" (Absolute Regel 1).
  const { aufrufe, wahlversuche, status } = await postMitWerfenderQuelle(
    "kycReached",
    VARIANTE.STANDARD,
  );
  assert.equal(status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(aufrufe.get("tryReserveOutboundBudget") || 0, 0, "ein spaeteres Gate lief");
  assert.equal(wahlversuche, 0);
});

// ---- SEC-P6-4/5: die Zustellung der Ablehnung ------------------------------------------

test("SEC-P6-4: stirbt die Metrik-Dimension (tenantGeo) mit, wird trotzdem geantwortet", async () => {
  // Zweiter Fehlermodus, eigener Fall: tenantGeo ist Gate-Datenquelle UND Quelle der
  // PII-freien Metrik-Dimension. Ohne die fail-safe Beobachtung wirft sie in der
  // Ablehnungs-Senke ein zweites Mal - AUSSERHALB jedes Gates, also wieder ohne Antwort.
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

// ---- SEC-P6-6: Auditierbarkeit ohne Innenleben -----------------------------------------

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

// ---- Die Owner-Invariante der Fruehwarnung ---------------------------------------------

test("SEC-P6-6b: eine sterbende Fruehwarnung lehnt NICHT ab (eigener try/catch bleibt)", async () => {
  // claimPlatformSpendWarning haengt in einem EIGENEN try/catch (SAFETY-KERN,
  // telephony/outbound-gates.js): der Call ist an dieser Stelle bereits reserviert, ein
  // Throw duerfte daraus keine Ablehnung machen. Der neue generische Fang darf diese
  // Invariante nicht kassieren.
  const { status, wahlversuche } = await postMitWerfenderQuelle(
    "claimPlatformSpendWarning",
    VARIANTE.STANDARD,
  );
  assert.equal(status, HTTP_OK, "eine Warnung darf nie ablehnen");
  assert.equal(wahlversuche, 1);
});
