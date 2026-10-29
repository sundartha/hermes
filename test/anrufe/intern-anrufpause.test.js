import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEPLOY_TOKEN_MIN_LENGTH } from "../../src/routes/intern-anrufe-laufend.js";
import {
  ANRUFPAUSE_PATH,
  anrufpauseLesenHandler,
  anrufpauseSetzenHandler,
} from "../../src/routes/intern-anrufpause.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVICE_UNAVAILABLE = 503;
const ANTWORT_FRIST_MS = 2000;
const NUR_LESEN = 0o500;
const VOLLZUGRIFF = 0o700;
const TOKEN = "p".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const FALSCHES_TOKEN = "q".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const AUFRUFER_IP = "203.0.113.27";
const FEHLERDETAIL = "speicher_v6_kaputt";
const KEIN_ZWISCHENSPEICHER = "no-store";
const UNGUELTIG = Object.freeze({ error: "invalid_body" });
const NICHT_GESPEICHERT = Object.freeze({ error: "persist_failed" });
const UNGUELTIGE_KOERPER = Object.freeze([
  ["fehlt", undefined],
  ["null", null],
  ["leer", {}],
  ["Text statt Boolean", { an: "true" }],
  ["Zahl statt Boolean", { an: 1 }],
  ["null statt Boolean", { an: null }],
  ["zusaetzlicher Schluessel", { an: true, grund: "wartung" }],
  ["Liste", [true]],
]);
const STANDIN_NAMEN = [
  "callFinish lifecycle provisioning outboundGates callQuotaDenial requestTenant requireTenant",
  "conversationWatchdog ttsStore directiveSynth voiceRender costTruing messaging consultDelivery",
  "elevenLabsOutbound inboundBridges durableAuditFor",
].flatMap((zeile) => zeile.split(" "));

const DATENORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "intern-anrufpause-"));
const SPEICHERDATEI = path.join(DATENORDNER, "store.json");
const SPEICHERSTAND_OHNE_PAUSE = Object.freeze({
  settings: {},
  calls: [],
  numbers: [],
  notifications: [],
});
fs.writeFileSync(SPEICHERDATEI, JSON.stringify(SPEICHERSTAND_OHNE_PAUSE));
const { config } = await import("../../src/config.js");
Object.assign(config.server, { dataDir: DATENORDNER, webDistDir: path.join(DATENORDNER, "web") });
config.auth.deployToken = TOKEN;
const speicher = await import("../../src/store.js");
const { buildApp } = await import("../../src/app.js");

after(() => {
  fs.chmodSync(DATENORDNER, VOLLZUGRIFF);
  fs.rmSync(DATENORDNER, { recursive: true, force: true });
});

const standIn = new Proxy(function standIn() {}, {
  get: (_ziel, schluessel) => (schluessel === "then" ? undefined : standIn),
  apply: () => standIn,
});

function gespeicherterWert() {
  return JSON.parse(fs.readFileSync(SPEICHERDATEI, "utf8")).anrufpause;
}

async function mitMitschnitt(arbeit) {
  const zeilen = [];
  const { log, warn, error } = console;
  console.log = console.warn = console.error = (...teile) => zeilen.push(teile.join(" "));
  try {
    return { ergebnis: await arbeit(), zeilen };
  } finally {
    Object.assign(console, { log, warn, error });
  }
}

function attrappenSpeicher({ wirft = false } = {}) {
  const attrappe = { an: false, aufrufe: [], freigeben: null };
  attrappe.anrufpauseAktiv = () => attrappe.an;
  attrappe.setzeAnrufpause = (an) => {
    attrappe.aufrufe.push(an);
    return new Promise((fertig, scheitern) => {
      attrappe.freigeben = () => (wirft ? scheitern(new Error(FEHLERDETAIL)) : fertig(an));
    }).then(() => {
      attrappe.an = an;
    });
  };
  return attrappe;
}

function anfrage(koerper, authorization = `Bearer ${TOKEN}`) {
  return { headers: { authorization }, path: ANRUFPAUSE_PATH, ip: AUFRUFER_IP, body: koerper };
}

function antwortSammler() {
  const antwort = { status: HTTP_OK, kopf: {}, koerper: undefined, weiter: [] };
  const merken = (feld) => (wert) => {
    Object.assign(antwort, { [feld]: wert });
    return res;
  };
  const res = {
    set: (name, wert) => merken("kopf")({ ...antwort.kopf, [name.toLowerCase()]: wert }),
    status: merken("status"),
    json: merken("koerper"),
  };
  return { antwort, res, next: (fehler) => antwort.weiter.push(fehler) };
}

async function setzen(store, koerper, authorization) {
  const { antwort, res, next } = antwortSammler();
  const handler = anrufpauseSetzenHandler({ config: { auth: { deployToken: TOKEN } }, store });
  const laeuft = handler(anfrage(koerper, authorization), res, next);
  await new Promise((weiter) => setImmediate(weiter));
  return { antwort, laeuft };
}

async function setzenUndFreigeben(store, koerper) {
  return mitMitschnitt(async () => {
    const { antwort, laeuft } = await setzen(store, koerper);
    const vorFreigabe = antwort.koerper;
    store.freigeben();
    await laeuft;
    return { antwort, vorFreigabe };
  });
}

test("Anrufpause: GET liefert genau {an} mit dem Wert des Speichers und no-store", () => {
  const store = attrappenSpeicher();
  const handler = anrufpauseLesenHandler({ config: { auth: { deployToken: TOKEN } }, store });
  for (const an of [false, true]) {
    store.an = an;
    const { antwort, res } = antwortSammler();
    handler(anfrage(undefined), res);
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(antwort.koerper, { an });
    assert.deepEqual(antwort.kopf, { "cache-control": KEIN_ZWISCHENSPEICHER });
  }
});

test("Anrufpause: POST ohne genau {an: <boolean>} gibt 400 und setzt nichts", async () => {
  for (const [fall, koerper] of UNGUELTIGE_KOERPER) {
    const store = attrappenSpeicher();
    const { ergebnis, zeilen } = await mitMitschnitt(() => setzen(store, koerper));
    assert.equal(ergebnis.antwort.status, HTTP_BAD_REQUEST, fall);
    assert.deepEqual(ergebnis.antwort.koerper, UNGUELTIG, fall);
    assert.equal(ergebnis.antwort.kopf["cache-control"], KEIN_ZWISCHENSPEICHER, fall);
    assert.deepEqual(store.aufrufe, [], fall);
    assert.deepEqual(zeilen, [], fall);
  }
});

test("Anrufpause: POST mit falschem Token gibt 401 und setzt nichts", async () => {
  const store = attrappenSpeicher();
  const { ergebnis } = await mitMitschnitt(() =>
    setzen(store, { an: true }, `Bearer ${FALSCHES_TOKEN}`),
  );
  assert.equal(ergebnis.antwort.status, HTTP_UNAUTHORIZED);
  assert.deepEqual(store.aufrufe, []);
});

test("Anrufpause: gueltiges POST antwortet erst nach dem Setzen mit genau {an} und schreibt eine Audit-Zeile", async () => {
  for (const an of [true, false]) {
    const store = attrappenSpeicher();
    const { ergebnis, zeilen } = await setzenUndFreigeben(store, { an });
    assert.equal(ergebnis.vorFreigabe, undefined);
    assert.deepEqual(store.aufrufe, [an]);
    assert.equal(ergebnis.antwort.status, HTTP_OK);
    assert.deepEqual(ergebnis.antwort.koerper, { an });
    assert.deepEqual(Object.keys(ergebnis.antwort.koerper), ["an"]);
    assert.equal(ergebnis.antwort.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
    assert.deepEqual(ergebnis.antwort.weiter, []);
    assert.deepEqual(zeilen, [`[audit] anrufpause_gesetzt ip=system an=${an}`]);
  }
});

test("Anrufpause: scheitert das Setzen, antwortet POST mit 503 persist_failed ohne Fehlerdetails", async () => {
  const store = attrappenSpeicher({ wirft: true });
  const { ergebnis, zeilen } = await setzenUndFreigeben(store, { an: true });
  assert.equal(ergebnis.vorFreigabe, undefined);
  assert.equal(ergebnis.antwort.status, HTTP_SERVICE_UNAVAILABLE);
  assert.deepEqual(ergebnis.antwort.koerper, NICHT_GESPEICHERT);
  assert.equal(ergebnis.antwort.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
  assert.deepEqual(ergebnis.antwort.weiter, []);
  assert.equal(store.an, false);
  assert.deepEqual(zeilen, ["[audit] anrufpause_fehlgeschlagen ip=system an=true"]);
  const text = JSON.stringify([ergebnis.antwort, zeilen]);
  assert.deepEqual(
    [FEHLERDETAIL, AUFRUFER_IP, TOKEN].filter((wert) => text.includes(wert)),
    [],
  );
});

test("Anrufpause: eine store.json ohne Feld anrufpause gilt als nicht pausiert und bekommt beim Speichern false", () => {
  assert.equal(
    Object.hasOwn(JSON.parse(fs.readFileSync(SPEICHERDATEI, "utf8")), "anrufpause"),
    false,
  );
  assert.equal(speicher.anrufpauseAktiv(), false);
  assert.equal(speicher.load().anrufpause, false);
  speicher.save();
  assert.equal(gespeicherterWert(), false);
});

test("Anrufpause: der Speicher zaehlt nur echtes true als Pause und schreibt sie in store.json", async () => {
  assert.equal(speicher.anrufpauseAktiv(), false);
  assert.equal(await speicher.setzeAnrufpause(true), true);
  assert.equal(speicher.anrufpauseAktiv(), true);
  assert.equal(gespeicherterWert(), true);
  await speicher.setzeAnrufpause(false);
  assert.equal(speicher.anrufpauseAktiv(), false);
  assert.equal(gespeicherterWert(), false);
  for (const fremderWert of ["ja", 1, "true"]) {
    speicher.load().anrufpause = fremderWert;
    assert.equal(speicher.anrufpauseAktiv(), false, JSON.stringify(fremderWert));
  }
  speicher.load().anrufpause = false;
});

test("Anrufpause: die echte App liest und setzt /intern/anrufpause mit Konfiguration und Speicher", async (kontext) => {
  const abhaengigkeiten = {
    ...Object.fromEntries(STANDIN_NAMEN.map((name) => [name, standIn])),
    config,
    store: speicher,
    audit: () => {},
  };
  const { ergebnis: app } = await mitMitschnitt(async () => (await buildApp(abhaengigkeiten)).app);
  const server = await new Promise((fertig) => {
    const lauscht = app.listen(0, "127.0.0.1", () => fertig(lauscht));
  });
  kontext.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const adresse = `http://127.0.0.1:${server.address().port}${ANRUFPAUSE_PATH}`;
  const authorization = `Bearer ${TOKEN}`;
  const lesen = async () =>
    (
      await abrufMitFrist(adresse, {
        headers: { authorization },
        signal: AbortSignal.timeout(ANTWORT_FRIST_MS),
      })
    ).json();
  assert.deepEqual(await lesen(), { an: false });
  const { ergebnis: gesetzt } = await mitMitschnitt(() =>
    abrufMitFrist(adresse, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ an: true }),
      signal: AbortSignal.timeout(ANTWORT_FRIST_MS),
    }),
  );
  assert.equal(gesetzt.status, HTTP_OK);
  assert.deepEqual(await gesetzt.json(), { an: true });
  assert.equal(speicher.anrufpauseAktiv(), true);
  assert.deepEqual(await lesen(), { an: true });
  await speicher.setzeAnrufpause(false);
});

test("Anrufpause: ist der Datenordner schreibgeschuetzt, wirft das Setzen und der alte Wert bleibt", async (kontext) => {
  assert.equal(speicher.anrufpauseAktiv(), false);
  fs.chmodSync(DATENORDNER, NUR_LESEN);
  kontext.after(() => fs.chmodSync(DATENORDNER, VOLLZUGRIFF));
  await assert.rejects(() => speicher.setzeAnrufpause(true));
  assert.equal(speicher.anrufpauseAktiv(), false);
  assert.equal(gespeicherterWert(), false);
});

const crypto = await import("node:crypto");
const express = (await import("express")).default;
const { mitRoutenServer, postJson } = await import("./routen-server.js");
const { makeOnboardRoutes } = await import("../../src/routes/api-onboard.js");
const { makeBillingRoutes } = await import("../../src/routes/api-billing.js");
const { makeInboxRoutes } = await import("../../src/routes/api-inbox.js");
const { makeStripeWebhookRoute } = await import("../../src/routes/stripe-webhook.js");
const { ANRUFE_LAUFEND_PATH, anrufeLaufendHandler } = await import(
  "../../src/routes/intern-anrufe-laufend.js"
);

const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const VIELE = 1000;
const KEINE = 0;
const MS_JE_SEKUNDE = 1000;
const NEGATIVER_OFFSET = -1;
const IDENTITAET_HOECHSTLAENGE = 254;
const KEINE_TENANT_ZUORDNUNG = { error: "Keine Tenant-Zuordnung fuer diese Identitaet." };
const UNGUELTIGE_TENANT_ID = {
  error: `tenantId ist Pflicht (nicht leer, ohne Whitespace, <=${IDENTITAET_HOECHSTLAENGE} Zeichen)`,
};
const PERSISTENZ_FEHLGESCHLAGEN = { error: "Persistenz fehlgeschlagen" };
const KEIN_SUBSCRIBER = { error: "Kein aktiver, verifizierter Subscriber - kein Nummernkauf." };
const STRIPE_GEHEIMNIS = "whsec_fehlerantwort_test";
const DURCHLASS = (_anfrage, _antwort, weiter) => weiter();
const OPERATOR_FREI = { webAuthMw: DURCHLASS, adminMw: DURCHLASS };
const ONBOARD_ABLEHNUNGEN = [
  ["tenant_inactive", { maxNumbers: VIELE, maxNumbersPerTenant: VIELE }, HTTP_FORBIDDEN],
  ["tenant_cap", { maxNumbers: VIELE, maxNumbersPerTenant: KEINE }, HTTP_CONFLICT],
  ["global_cap", { maxNumbers: KEINE, maxNumbersPerTenant: VIELE }, HTTP_TOO_MANY_REQUESTS],
];
const WIEDERHOLUNG_ABLEHNUNGEN = [
  ["tenant_cap", HTTP_CONFLICT],
  ["already_provisioned", HTTP_CONFLICT],
  ["needs_manual_reconcile", HTTP_CONFLICT],
  ["global_cap", HTTP_TOO_MANY_REQUESTS],
  ["persist_error", HTTP_SERVICE_UNAVAILABLE],
  ["grund_den_niemand_kennt", HTTP_BAD_REQUEST],
];

function tenantListe() {
  const stand = speicher.load();
  stand.tenants ??= [];
  return stand.tenants;
}

function legeTenantAn(tenant) {
  tenantListe().push(tenant);
}

function onboardRouten({ provisioning = {}, nummern = {}, geoAn = false, kaufAn = false } = {}) {
  tenantListe();
  const auditZeilen = [];
  const router = makeOnboardRoutes({
    store: speicher,
    config: {
      ...config,
      provisioning: {
        ...config.provisioning,
        geoEnabled: geoAn,
        provisioningEnabled: kaufAn,
        forceNumberCountry: "",
        maxNumbers: VIELE,
        maxNumbersPerTenant: VIELE,
        ...nummern,
      },
    },
    audit: (ereignis, _anfrage, detail) => auditZeilen.push([ereignis, detail]),
    provisioning,
    operatorAuth: OPERATOR_FREI,
  });
  return { router, auditZeilen };
}

async function antwortVon(antwort) {
  return { status: antwort.status, koerper: await antwort.json() };
}

function onboardAntwort(router, pfad, koerper) {
  return mitRoutenServer(router, async (basis) =>
    antwortVon(await postJson(`${basis}${pfad}`, koerper)),
  );
}

function billingRouten({ billing = {}, billingKonfig = {} } = {}) {
  return makeBillingRoutes({
    config: { ...config, billing: { ...config.billing, paymentEnabled: true, ...billingKonfig } },
    store: speicher,
    audit: () => {},
    billing,
    tenant: { requireTenant: () => "t_fehlerantwort_abrechnung" },
    costTruing: {},
    operatorAuth: OPERATOR_FREI,
  });
}

function stripeSignatur(rohkoerper) {
  const zeitpunkt = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const pruefsumme = crypto
    .createHmac("sha256", STRIPE_GEHEIMNIS)
    .update(`${zeitpunkt}.${rohkoerper}`)
    .digest("hex");
  return `t=${zeitpunkt},v1=${pruefsumme}`;
}

async function stripeAntwort(rohkoerper, signatur) {
  const { antwort, res } = antwortSammler();
  const route = makeStripeWebhookRoute({
    config: { billing: { paymentEnabled: true, stripeWebhookSecret: STRIPE_GEHEIMNIS } },
    store: speicher,
    audit: () => {},
  });
  await route({ rawBody: Buffer.from(rohkoerper), headers: { "stripe-signature": signatur } }, res);
  return antwort;
}

test("Onboarding: ohne Geo-Treffer legt POST /api/onboard Tenant und Nummer an und protokolliert die Nummer", async () => {
  const { router, auditZeilen } = onboardRouten({ geoAn: true });
  const tenantId = "t_fehlerantwort_ohne_geo";
  const { status, koerper } = await onboardAntwort(router, "/api/onboard", { tenantId });
  assert.equal(status, HTTP_OK);
  assert.equal(koerper.provisioning, "disabled");
  assert.equal(koerper.tenantId, tenantId);
  assert.deepEqual(auditZeilen, [
    ["onboard_request", `tenant=${tenantId} number=${koerper.numberId}`],
  ]);
});

test("Onboarding: scheitert die Warteschlange, antwortet POST /api/onboard mit 503 und startet keinen Kauf", async () => {
  const drains = [];
  const provisioning = {
    queueProvisioning: async () => ({ ok: false }),
    runProvisioningDrainExclusive: async () => drains.push("drain"),
  };
  const { router, auditZeilen } = onboardRouten({ provisioning, kaufAn: true });
  const tenantId = "t_fehlerantwort_warteschlange_kaputt";
  const ergebnis = await onboardAntwort(router, "/api/onboard", { tenantId });
  assert.deepEqual(ergebnis, {
    status: HTTP_SERVICE_UNAVAILABLE,
    koerper: PERSISTENZ_FEHLGESCHLAGEN,
  });
  assert.deepEqual(
    auditZeilen.map(([ereignis]) => ereignis),
    ["onboard_request"],
  );
  assert.deepEqual(drains, []);
});

test("Onboarding: steht der Kauf in der Warteschlange, protokolliert POST /api/onboard Tenant, Nummer und Auftrag", async () => {
  const provisioning = {
    queueProvisioning: async () => ({ ok: true, jobId: "job_fehlerantwort" }),
    runProvisioningDrainExclusive: async () => {},
  };
  const { router, auditZeilen } = onboardRouten({ provisioning, kaufAn: true });
  const tenantId = "t_fehlerantwort_warteschlange";
  const { status, koerper } = await onboardAntwort(router, "/api/onboard", { tenantId });
  assert.equal(status, HTTP_OK);
  assert.equal(koerper.jobId, "job_fehlerantwort");
  assert.deepEqual(auditZeilen, [
    ["onboard_request", `tenant=${tenantId} number=${koerper.numberId}`],
    ["onboard_queued", `tenant=${tenantId} number=${koerper.numberId} job=job_fehlerantwort`],
  ]);
});

test("Onboarding: Wiederholung ohne aktiven Subscriber antwortet 403 mit dem bisherigen Text", async () => {
  const { router } = onboardRouten();
  const tenantId = "t_fehlerantwort_fremd";
  const ergebnis = await onboardAntwort(router, "/api/onboard/retry", { tenantId });
  assert.deepEqual(ergebnis, { status: HTTP_FORBIDDEN, koerper: KEIN_SUBSCRIBER });
});

test("Abrechnung: Kartenrueckkehr ohne session_id gibt 400, mit fremdem Kunden 403, je mit dem bisherigen Text", async () => {
  const router = billingRouten({
    billing: { getCheckoutSessionResult: async () => ({ customerId: "cus_fremd" }) },
  });
  const adresse = "/api/billing/checkout-return";
  const ergebnisse = await mitRoutenServer(router, async (basis) => [
    await antwortVon(await abrufMitFrist(`${basis}${adresse}`)),
    await antwortVon(await abrufMitFrist(`${basis}${adresse}?session_id=cs_x`)),
  ]);
  assert.deepEqual(ergebnisse, [
    { status: HTTP_BAD_REQUEST, koerper: { error: "session_id ist Pflicht" } },
    { status: HTTP_FORBIDDEN, koerper: { error: "Customer-Mismatch" } },
  ]);
});

test("[NIE1] ein abgelehnter Nummernkauf am Onboarding behaelt 403, 409 und 429 je Grund", async () => {
  for (const [grund, nummern, erwartet] of ONBOARD_ABLEHNUNGEN) {
    const tenantId = `t_fehlerantwort_nie1_${grund}`;
    if (grund === "tenant_inactive") legeTenantAn({ id: tenantId, status: "closed" });
    const { router } = onboardRouten({ nummern });
    const ergebnis = await onboardAntwort(router, "/api/onboard", { tenantId });
    assert.deepEqual(
      ergebnis,
      { status: erwartet, koerper: { error: `Nummer-Anfrage abgelehnt (${grund})` } },
      grund,
    );
  }
});

test("[NIE1] eine abgelehnte Wiederholung behaelt 409, 429, 503 und 400 je Grund", async () => {
  const tenantId = "t_fehlerantwort_nie1_wiederholung";
  legeTenantAn({ id: tenantId, status: "active", kycLevel: "card" });
  for (const [grund, erwartet] of WIEDERHOLUNG_ABLEHNUNGEN) {
    const provisioning = { triggerTenantProvisioning: async () => ({ ok: false, reason: grund }) };
    const { router } = onboardRouten({ provisioning });
    const { status } = await onboardAntwort(router, "/api/onboard/retry", { tenantId });
    assert.equal(status, erwartet, grund);
  }
});

test("[NIE2] eine tenantId mit Leerzeichen gibt 400 mit dem bisherigen Text und legt nichts an", async () => {
  const kaeufe = [];
  const provisioning = {
    queueProvisioning: async (...auftrag) => {
      kaeufe.push(auftrag);
      return { ok: true, jobId: "job_nie2" };
    },
    runProvisioningDrainExclusive: async () => {},
  };
  const { router } = onboardRouten({ provisioning, kaufAn: true });
  const tenantId = "t_fehlerantwort nie2";
  const nummernVorher = speicher.load().numbers.length;
  const ergebnis = await onboardAntwort(router, "/api/onboard", { tenantId });
  assert.deepEqual(ergebnis, { status: HTTP_BAD_REQUEST, koerper: UNGUELTIGE_TENANT_ID });
  assert.deepEqual(
    tenantListe().filter((tenant) => tenant.id === tenantId),
    [],
  );
  assert.equal(speicher.load().numbers.length, nummernVorher);
  assert.deepEqual(kaeufe, []);
});

test("[NIE3] die Statuscodes der Abrechnungs-, Posteingangs- und Webhook-Routen kommen unveraendert an", async () => {
  const abrechnung = billingRouten({
    billing: { getCheckoutSessionResult: async () => ({ customerId: "cus_fremd" }) },
    billingKonfig: { platformFixedCostUsdCentsPerMonth: Number.MAX_SAFE_INTEGER },
  });
  const abrechnungStatus = await mitRoutenServer(abrechnung, async (basis) => [
    (await abrufMitFrist(`${basis}/api/billing/checkout-return`)).status,
    (await abrufMitFrist(`${basis}/api/billing/checkout-return?session_id=cs_x`)).status,
    (await abrufMitFrist(`${basis}/api/billing/platform-costs`)).status,
  ]);
  assert.deepEqual(abrechnungStatus, [HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_SERVER_ERROR]);

  const posteingang = makeInboxRoutes({
    store: speicher,
    audit: () => {},
    tenant: { requireTenant: () => "t_fehlerantwort_posteingang" },
  });
  const posteingangStatus = await mitRoutenServer(posteingang, async (basis) => {
    const koerper = { include_seen: true, offset: NEGATIVER_OFFSET };
    return (await postJson(`${basis}/api/inbox/poll`, koerper)).status;
  });
  assert.equal(posteingangStatus, HTTP_BAD_REQUEST);

  const signiert = await stripeAntwort("kein json", stripeSignatur("kein json"));
  const unsigniert = await stripeAntwort("{}", "t=1,v1=00");
  assert.deepEqual([signiert.status, unsigniert.status], [HTTP_BAD_REQUEST, HTTP_BAD_REQUEST]);
});

test("[NIE3] die Statuscodes der Onboarding-Routen kommen unveraendert an", async () => {
  const persistenzKaputt = {
    queueProvisioning: async () => ({ ok: false }),
    runProvisioningDrainExclusive: async () => {},
  };
  const faelle = [
    [{ nummern: { maxNumbersPerTenant: KEINE } }, "/api/onboard", HTTP_CONFLICT],
    [{ nummern: { maxNumbers: KEINE } }, "/api/onboard", HTTP_TOO_MANY_REQUESTS],
    [{ provisioning: persistenzKaputt, kaufAn: true }, "/api/onboard", HTTP_SERVICE_UNAVAILABLE],
    [{}, "/api/onboard/retry", HTTP_FORBIDDEN],
  ];
  for (const [index, [optionen, pfad, erwartet]] of faelle.entries()) {
    const { router } = onboardRouten(optionen);
    const tenantId = `t_fehlerantwort_nie3_${index}`;
    const { status } = await onboardAntwort(router, pfad, { tenantId });
    assert.equal(status, erwartet, pfad);
  }
});

test("[NIE3] die Statuscodes der Deploy-Token-Routen kommen unveraendert an", async (kontext) => {
  const abhaengigkeiten = { config: { auth: { deployToken: TOKEN } }, store: speicher };
  const router = express.Router();
  router.get(ANRUFE_LAUFEND_PATH, anrufeLaufendHandler(abhaengigkeiten));
  router.post(ANRUFPAUSE_PATH, anrufpauseSetzenHandler(abhaengigkeiten));
  kontext.after(() => fs.chmodSync(DATENORDNER, VOLLZUGRIFF));
  const pauseSetzen = async (adresse, koerper) =>
    (
      await abrufMitFrist(adresse, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify(koerper),
      })
    ).status;
  const { ergebnis: status } = await mitMitschnitt(() =>
    mitRoutenServer(router, async (basis) => {
      const pause = `${basis}${ANRUFPAUSE_PATH}`;
      const abgewiesen = (
        await abrufMitFrist(`${basis}${ANRUFE_LAUFEND_PATH}`, {
          headers: { authorization: `Bearer ${FALSCHES_TOKEN}` },
        })
      ).status;
      const ungueltig = await pauseSetzen(pause, { an: "ja" });
      fs.chmodSync(DATENORDNER, NUR_LESEN);
      const nichtGespeichert = await pauseSetzen(pause, { an: true });
      fs.chmodSync(DATENORDNER, VOLLZUGRIFF);
      return [abgewiesen, ungueltig, nichtGespeichert];
    }),
  );
  assert.deepEqual(status, [HTTP_UNAUTHORIZED, HTTP_BAD_REQUEST, HTTP_SERVICE_UNAVAILABLE]);
  assert.equal(speicher.anrufpauseAktiv(), false);
});

test("[NIE3] eine Identitaet ohne Tenant bekommt am laufenden Server 403 mit dem bisherigen Text", async () => {
  const { startServer } = await import("../helpers.js");
  const server = await startServer();
  try {
    const antwort = await abrufMitFrist(`${server.localUrl}/api/inbox/poll`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-identity": "niemand-bekannt" },
      body: "{}",
    });
    assert.deepEqual(await antwortVon(antwort), {
      status: HTTP_FORBIDDEN,
      koerper: KEINE_TENANT_ZUORDNUNG,
    });
  } finally {
    await server.stop();
  }
});
