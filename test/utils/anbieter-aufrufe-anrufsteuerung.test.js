import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { operatorAuthPassThrough } from "../operator-route-app.js";

const TOKEN = "t".repeat(20);
const BENUTZER = "123456";
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_GATEWAY = 502;
const HTTP_ZU_VIELE = 429;
const HTTP_FEHLER = 500;
const ZAEHLER = "hermes.anbieter.aufrufe";
const DAUER = "hermes.anbieter.dauer";
const GRENZE_ABBRUCH_MS = 1000;
const MANDANT = "owner";
const ZIEL = "+4915100000009";
const ZIEL_B10 = "+4915100000010";
const ZIEL_B11_OHNE = "+4915100000011";
const ZIEL_B11 = "+4915100000012";
const ZIEL_B12 = "+4915100000013";
const NUMMER_IM_FEHLERTEXT = "+4915100000001";
const FEHLERTEXT_SUCHE = `Number ${NUMMER_IM_FEHLERTEXT} rate limited`;
const ABLEHNUNG_TEXT = "Provider hat den Anruf abgelehnt (HTTP 403). Account-/Nummern-Konfiguration pruefen.";
const MS_JE_MINUTE = 60_000;
const ENDE_VOR_MINUTEN = 200;
const IST_KOSTEN_CENT_NACHHER = 85;
const VORHER_KOSTEN_CENT = 100;
const SCHAETZUNG_CENT = 20;
const BELEG_MIKRO_CENT = 5_000_000;
const SOLL_RUFNUMMER = "+4930123456";
const HOECHSTDAUER_S = 60;

const telnyx = {
  anfragen: [],
  anrufStart: { status: HTTP_OK, koerper: { sid: "CAmessung_start" } },
  auflegen: { status: HTTP_OK, koerper: {} },
  suche: { status: HTTP_OK, koerper: { data: [] } },
  belege: () => ({ data: [] }),
};

const telnyxStub = http.createServer(async (req, res) => {
  let rumpf = "";
  for await (const stueck of req) rumpf += stueck;
  telnyx.anfragen.push({ methode: req.method, pfad: req.url, rumpf });
  let antwort = telnyx.suche;
  if (req.url.startsWith("/v2/texml/calls/")) antwort = telnyx.anrufStart;
  else if (req.url.startsWith("/v2/texml/Accounts/")) antwort = telnyx.auflegen;
  else if (req.url.startsWith("/v2/detail_records"))
    antwort = { status: HTTP_OK, koerper: telnyx.belege(new URL(req.url, "http://x").searchParams) };
  res.writeHead(antwort.status, { "content-type": "application/json" });
  res.end(JSON.stringify(antwort.koerper));
});
await new Promise((bereit) => telnyxStub.listen(0, "127.0.0.1", bereit));
process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyxStub.address().port}`;
process.env.TELNYX_API_KEY = "KEYtest-anrufsteuerung";
process.env.TELNYX_CONNECTION_ID = "conn_test";
process.env.TELNYX_ACCOUNT_SID = "acct_test";
process.env.PROVIDER_CURRENCY = "USD";

const helfer = await import("../helpers.js");
const { seedCall, seedState, tempDataDir, schalteNebenkanaeleAb, callAttrappenBesitztJedenAnruf, waitUntil } = helfer;
schalteNebenkanaeleAb();
process.env.DATA_DIR = tempDataDir(
  seedState({
    calls: ["b13", "b14"].map((kennung) =>
      seedCall({ id: `anruf_${kennung}`, twilioSid: `CA_${kennung}`, provider: "telnyx", maxDurationS: HOECHSTDAUER_S }),
    ),
  }),
);
const { withConfigNamespaces } = await import("../config-namespaces-helper.js");
const { makePgTestStore } = await import("../pg-helpers.js");
const { starteTelemetrie } = await import("../../src/utils/telemetrie.js");
const { makeOnboardRoutes } = await import("../../src/routes/api-onboard.js");
const { makeCallRoutes } = await import("../../src/routes/api-calls.js");
const { makeBillingRoutes } = await import("../../src/routes/api-billing.js");
const { makeCostTruing } = await import("../../src/billing/cost-truing.js");
const { handleProvisionJob } = await import("../../src/worker/provisioning.js");
const { terminateAndBillCall, billThunk, hangUpAction } = await import("../../src/telephony/call-termination.js");
const { voiceControl, numberProvisioning } = await import("../../src/telephony/registry.js");
const { makeStubStore, fakeConfig, makeDueOutboundCall, measuredSipTrunkingRecord } = await import(
  "../cost-truing-harness.js"
);
const { config: hermesConfig } = await import("../../src/config.js");
const telephonie = hermesConfig.telephony;
const { makeDefaultState, usageFor } = await import("../../src/store/state-ops.js");
const { BOOTSTRAP_TENANT_ID, emptyUsage } = await import("../../src/store/defaults.js");
const { KOSTENPROFIL } = await import("../../src/billing/kostenarten.js");

const store = await import("../../src/store.js");

const ANRUF_FUER = (nummer) => `anruf_${nummer}`;

after(() => new Promise((fertig) => telnyxStub.close(fertig)));

function zuruecksetzen() {
  telnyx.anfragen.length = 0;
  telnyx.anrufStart = { status: HTTP_OK, koerper: { sid: "CAmessung_start" } };
  telnyx.auflegen = { status: HTTP_OK, koerper: {} };
  telnyx.suche = { status: HTTP_OK, koerper: { data: [] } };
  telnyx.belege = () => ({ data: [] });
}

function startEmpfaenger() {
  const empfangen = [];
  const empfaenger = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      empfangen.push(JSON.parse(Buffer.concat(teile).toString("utf8")));
      res.writeHead(HTTP_OK, { "content-type": "application/json" }).end("{}");
    });
  });
  return new Promise((resolve) => {
    empfaenger.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${empfaenger.address().port}/otlp`;
      resolve({ url, empfangen, stop: () => new Promise((fertig) => empfaenger.close(fertig)) });
    });
  });
}

const metrikenVon = (exporte, name) =>
  exporte.slice(-1).flatMap((e) =>
    e.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics.filter((m) => m.name === name))),
  );
const attribute = (punkt) => Object.fromEntries(punkt.attributes.map((a) => [a.key, a.value.stringValue]));
const zaehlerPunkte = (exporte) =>
  metrikenVon(exporte, ZAEHLER).flatMap((m) =>
    m.sum.dataPoints.map((p) => ({ ...attribute(p), wert: Number(p.asInt ?? p.asDouble) })),
  );

async function mitTelemetrie(lauf) {
  const empfaenger = await startEmpfaenger();
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    benutzer: BENUTZER,
    token: TOKEN,
    instanzKennung: "instanz-test",
    version: "test",
    intervallMs: 3_600_000,
  });
  try {
    return await lauf({ telemetrie, empfaenger });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
  }
}

const wirftBeimErfassen = (telemetrie) =>
  mock.method(telemetrie, "messeAnbieter", () => {
    throw new Error("Erfassen kaputt");
  });
const haengtBeimErfassen = (telemetrie) => mock.method(telemetrie, "messeAnbieter", () => new Promise(() => {}));

function anrufApp({ finishCall }) {
  const config = withConfigNamespaces({
    multiTenant: false,
    elevenLabsOutbound: { enabled: false },
    skipTwilioSignatureCheck: true,
    allowedCountryCodes: ["+49"],
    publicUrl: "http://127.0.0.1:1",
  });
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...callAttrappenBesitztJedenAnruf(MANDANT),
      store,
      config,
      outboundGates: [
        {
          name: "fester-kontext",
          run: (ctx) => {
            Object.assign(ctx, {
              requestedBy: "owner",
              tenantId: BOOTSTRAP_TENANT_ID,
              mandate: null,
              context: null,
              fromNumber: SOLL_RUFNUMMER,
              outboundProvider: "telnyx",
              numberRecord: null,
              reserveCents: 0,
              maxDur: HOECHSTDAUER_S,
            });
            return null;
          },
        },
      ],
      callQuotaDenial: () => null,
      voiceControl,
      terminateAndBillCall,
      hangUpAction,
      billThunk,
      finishCall,
    }),
  );
  return app;
}

async function mitAnrufApp(finishCall, lauf) {
  const server = await new Promise((resolve) => {
    const srv = anrufApp({ finishCall }).listen(0, "127.0.0.1", () => resolve(srv));
  });
  const stummgeschaltet = mock.method(console, "error", () => {});
  try {
    return await lauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    stummgeschaltet.mock.restore();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const rufeAn = (ziel) => async (url) => {
  const res = await abrufMitFrist(`${url}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: ziel, objective: `Termin vereinbaren fuer ${ziel}` }),
  });
  return { status: res.status, koerper: await res.json() };
};

const anrufStarts = () => telnyx.anfragen.filter((a) => a.pfad.startsWith("/v2/texml/calls/"));
const auflegeBefehle = () => telnyx.anfragen.filter((a) => a.pfad.startsWith("/v2/texml/Accounts/"));
const keineAbrechnung = () => {};

function einrichtungOhneHold(speicher) {
  const lauf = { fertig: null };
  const bereit = new Promise((resolve) => {
    lauf.fertig = resolve;
  });
  const provisioning = {
    queueProvisioning: async () => ({ ok: true, jobId: "job_steuerung" }),
    runProvisioningDrainExclusive: async () => {
      const state = speicher.load();
      const nummer = state.numbers.find((n) => n.status === "requested");
      const optionen = { countryCode: "US", holdAmountCents: 0, currency: "EUR" };
      await handleProvisionJob(state, { payload: { numberId: nummer.id } }, { provisioner: numberProvisioning() }, optionen).catch(() => {});
      lauf.fertig();
    },
  };
  return { provisioning, bereit };
}

async function einrichtungStarten() {
  const { store: speicher } = await makePgTestStore();
  const { provisioning, bereit } = einrichtungOhneHold(speicher);
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: speicher,
      config: withConfigNamespaces({
        maxNumbers: 10,
        maxNumbersPerTenant: 1,
        provisioningEnabled: true,
        provisioningCountry: "DE",
        forceNumberCountry: "",
        geoEnabled: false,
        defaultTenantBudgetCents: 0,
      }),
      audit: () => {},
      provisioning,
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  try {
    await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "t_steuerung" }),
    });
    await bereit;
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("S7: weder Nummern noch Fehlertext tauchen im Export auf, die Label-Namen sind fest", async () => {
  zuruecksetzen();
  telnyx.suche = {
    status: HTTP_ZU_VIELE,
    koerper: { errors: [{ code: "99999", title: FEHLERTEXT_SUCHE }] },
  };
  const exporte = await mitTelemetrie(async ({ telemetrie, empfaenger }) => {
    await einrichtungStarten();
    await mitAnrufApp(keineAbrechnung, async (url) => {
      const antwort = await rufeAn(ZIEL)(url);
      assert.equal(antwort.status, HTTP_OK);
    });
    await telemetrie.spuele();
    return empfaenger.empfangen;
  });
  const roh = JSON.stringify(exporte);
  for (const verboten of [NUMMER_IM_FEHLERTEXT, ZIEL, "rate limited"]) assert.ok(!roh.includes(verboten), verboten);
  const sortiert = (liste) => liste.sort((a, b) => a.vorgang.localeCompare(b.vorgang));
  assert.deepEqual(sortiert(zaehlerPunkte(exporte)), [
    { anbieter: "telnyx", vorgang: "anruf-starten", ergebnis: "ok", wert: 1 },
    { anbieter: "telnyx", vorgang: "nummern-suchen", ergebnis: "429", wert: 1 },
  ]);
  const [zaehler] = metrikenVon(exporte, ZAEHLER);
  const [dauer] = metrikenVon(exporte, DAUER);
  const labelNamen = (metrik, punkte) => [...new Set(punkte.flatMap((p) => p.attributes.map((a) => a.key)))].sort();
  assert.deepEqual(labelNamen(zaehler, zaehler.sum.dataPoints), ["anbieter", "ergebnis", "vorgang"]);
  assert.deepEqual(labelNamen(dauer, dauer.histogram.dataPoints), ["anbieter", "vorgang"]);
});

async function sweepMitBeleg({ mitMessung, ohneSchluessel = false }) {
  zuruecksetzen();
  const jetzt = Date.now();
  const state = makeDefaultState();
  Object.assign(state.usage, { [BOOTSTRAP_TENANT_ID]: { ...emptyUsage(), costCents: VORHER_KOSTEN_CENT } });
  const anruf = makeDueOutboundCall(state, { nowMs: jetzt, legRef: { callControlId: "cc_steuerung" }, estimatedCostCents: SCHAETZUNG_CENT });
  anruf.costProfile = KOSTENPROFIL.TELNYX_BUDGET;
  const zeit = new Date(jetzt - ENDE_VOR_MINUTEN * MS_JE_MINUTE).toISOString();
  telnyx.belege = (abfrage) => {
    const typ = abfrage.get("filter[record_type]");
    if (typ !== "sip-trunking" && typ !== "call-control") return { data: [] };
    const beleg = measuredSipTrunkingRecord({
      at: zeit,
      sessionId: "sess_steuerung",
      callControlId: "cc_steuerung",
      cost: typ === "sip-trunking" ? "0.05" : "0",
      billedSec: 120,
    });
    return { data: [{ ...beleg, record_type: typ }] };
  };
  const speicher = makeStubStore(state, { nowMs: jetzt });
  const config = fakeConfig({ costTruingRequiredRecordTypes: ["sip-trunking", "call-control"] });
  const costTruing = makeCostTruing({ store: speicher, config, voiceControl, audit: () => {}, messaging: {}, now: () => jetzt });
  const app = express();
  app.use(
    makeBillingRoutes({ config, store: speicher, audit: () => {}, billing: {}, tenant: {}, costTruing, operatorAuth: operatorAuthPassThrough() }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const sweep = async () => {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/billing/cost-truing/sweep`, { method: "POST" });
    return res.json();
  };
  const gespeicherterSchluessel = telephonie.telnyxApiKey;
  if (ohneSchluessel) telephonie.telnyxApiKey = "";
  const stummgeschaltet = mock.method(console, "warn", () => {});
  let bericht;
  let exporte = [];
  try {
    if (mitMessung)
      exporte = await mitTelemetrie(async ({ telemetrie, empfaenger }) => {
        bericht = await sweep();
        await telemetrie.spuele();
        return empfaenger.empfangen;
      });
    else bericht = await sweep();
  } finally {
    stummgeschaltet.mock.restore();
    telephonie.telnyxApiKey = gespeicherterSchluessel;
    await new Promise((r) => server.close(r));
  }
  return {
    bericht,
    exporte,
    costCents: usageFor(state, BOOTSTRAP_TENANT_ID).costCents,
    quelle: anruf.costTruedSource,
    istKosten: anruf.actualCostMicroCents,
  };
}

test("B5: die Kostenabrechnung des Anrufs ist mit und ohne Messung gleich", async () => {
  const gebucht = ({ costCents, quelle, istKosten }) => ({ costCents, quelle, istKosten });
  const ohne = gebucht(await sweepMitBeleg({ mitMessung: false }));
  const mit = gebucht(await sweepMitBeleg({ mitMessung: true }));
  assert.equal(ohne.quelle, "kostenbuch_vollbeleg");
  assert.equal(ohne.costCents, IST_KOSTEN_CENT_NACHHER);
  assert.equal(ohne.istKosten, BELEG_MIKRO_CENT);
  assert.deepEqual(mit, ohne);
});

test("B8: ohne Telnyx-Schluessel steht kein Zaehler telnyx/fehler im Export", async () => {
  const lauf = await sweepMitBeleg({ mitMessung: true, ohneSchluessel: true });
  assert.equal(lauf.bericht.candidates, 1);
  assert.equal(lauf.costCents, VORHER_KOSTEN_CENT);
  assert.deepEqual(zaehlerPunkte(lauf.exporte).filter((p) => p.anbieter === "telnyx" && p.ergebnis === "fehler"), []);
});

test("B10: die Ablehnung eines Anrufs (403) bleibt 502 mit gleichem Text", async () => {
  zuruecksetzen();
  telnyx.anrufStart = { status: HTTP_FORBIDDEN, koerper: { errors: [{ code: "90003", title: "Forbidden" }] } };
  const antwort = await mitAnrufApp(keineAbrechnung, rufeAn(ZIEL_B10));
  assert.equal(antwort.status, HTTP_BAD_GATEWAY);
  assert.deepEqual(antwort.koerper, { error: ABLEHNUNG_TEXT });
  assert.equal(anrufStarts().length, 1);
});

test("B11: wirft das Erfassen, startet genau ein Anruf und place_call antwortet wie ohne Messung", async () => {
  zuruecksetzen();
  const ohne = await mitAnrufApp(keineAbrechnung, rufeAn(ZIEL_B11_OHNE));
  zuruecksetzen();
  const warnung = mock.method(console, "warn", () => {});
  const mit = await mitTelemetrie(async ({ telemetrie }) => {
    const erfassen = wirftBeimErfassen(telemetrie);
    const antwort = await mitAnrufApp(keineAbrechnung, rufeAn(ZIEL_B11));
    return { antwort, versuche: erfassen.mock.callCount() };
  });
  warnung.mock.restore();
  assert.equal(mit.versuche, 1);
  assert.equal(anrufStarts().length, 1);
  assert.equal(mit.antwort.status, HTTP_OK);
  assert.deepEqual(Object.keys(mit.antwort.koerper).sort(), Object.keys(ohne.koerper).sort());
  assert.equal(mit.antwort.koerper.status, ohne.koerper.status);
});

test("B12: wirft das Erfassen, bleibt die Ablehnung 502 mit gleichem Text", async () => {
  zuruecksetzen();
  telnyx.anrufStart = { status: HTTP_FORBIDDEN, koerper: { errors: [{ code: "90003", title: "Forbidden" }] } };
  const warnung = mock.method(console, "warn", () => {});
  const antwort = await mitTelemetrie(async ({ telemetrie }) => {
    const erfassen = wirftBeimErfassen(telemetrie);
    const ergebnis = await mitAnrufApp(keineAbrechnung, rufeAn(ZIEL_B12));
    assert.equal(erfassen.mock.callCount(), 1);
    return ergebnis;
  });
  warnung.mock.restore();
  assert.equal(antwort.status, HTTP_BAD_GATEWAY);
  assert.deepEqual(antwort.koerper, { error: ABLEHNUNG_TEXT });
  assert.equal(anrufStarts().length, 1);
});

async function bricheAb(url, kennung) {
  const beginn = performance.now();
  const res = await abrufMitFrist(`${url}/api/calls/${ANRUF_FUER(kennung)}/cancel`, { method: "POST" });
  const koerper = await res.json();
  return { koerper, dauerMs: performance.now() - beginn };
}

test("B13: eine haengende Messung haelt cancel_call nicht auf", async () => {
  zuruecksetzen();
  const ergebnis = await mitTelemetrie(async ({ telemetrie }) => {
    haengtBeimErfassen(telemetrie);
    return mitAnrufApp(keineAbrechnung, (url) => bricheAb(url, "b13"));
  });
  assert.equal(auflegeBefehle().length, 1);
  assert.match(auflegeBefehle()[0].pfad, /\/Calls\/CA_b13$/);
  assert.deepEqual(ergebnis.koerper, { status: "cancelled" });
  assert.ok(ergebnis.dauerMs < GRENZE_ABBRUCH_MS, `dauerte ${ergebnis.dauerMs} ms`);
});

test("B14: eine haengende Messung haelt die Abrechnung nach einem gescheiterten Auflegen nicht auf", async () => {
  zuruecksetzen();
  telnyx.auflegen = { status: HTTP_FEHLER, koerper: {} };
  const abgerechnet = [];
  const ergebnis = await mitTelemetrie(async ({ telemetrie }) => {
    haengtBeimErfassen(telemetrie);
    return mitAnrufApp(
      (anruf) => abgerechnet.push(anruf.id),
      async (url) => {
        const antwort = await bricheAb(url, "b14");
        await waitUntil(() => abgerechnet.length > 0);
        return antwort;
      },
    );
  });
  assert.equal(auflegeBefehle().length, 1);
  assert.deepEqual(ergebnis.koerper, { status: "cancelled" });
  assert.ok(ergebnis.dauerMs < GRENZE_ABBRUCH_MS, `dauerte ${ergebnis.dauerMs} ms`);
  assert.deepEqual(abgerechnet, [ANRUF_FUER("b14")]);
  assert.equal(store.getCall(ANRUF_FUER("b14")).status, "cancelled");
});
