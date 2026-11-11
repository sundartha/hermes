import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { operatorAuthPassThrough } from "../operator-route-app.js";

const TOKEN = "t".repeat(20);
const BENUTZER = "123456";
const LANGSAME_ANTWORT_MS = 40;
const OBERGRENZE_DAUER_MS = 1000;
const HTTP_OK = 200;
const HTTP_ZU_VIELE = 429;
const HTTP_FEHLER = 500;
const NUMMER_IM_FEHLERTEXT = "+494291234567";
const ZAEHLER = "hermes.anbieter.aufrufe";
const DAUER = "hermes.anbieter.dauer";
const ERWARTETE_GRENZEN = 8;

let telnyxAntwort = { status: HTTP_OK, koerper: { data: [] }, verzoegerungMs: 0 };
const telnyxStub = http.createServer(async (req, res) => {
  req.resume();
  if (telnyxAntwort.verzoegerungMs) await echtWarten(telnyxAntwort.verzoegerungMs);
  res.writeHead(telnyxAntwort.status, { "content-type": "application/json" });
  res.end(JSON.stringify(telnyxAntwort.koerper));
});
await new Promise((bereit) => telnyxStub.listen(0, "127.0.0.1", bereit));
process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyxStub.address().port}`;
process.env.TELNYX_API_KEY = "KEYtest-anbieter-messung";

const { startServer, withFetch } = await import("../helpers.js");
const { withConfigNamespaces } = await import("../config-namespaces-helper.js");
const { makePgTestStore } = await import("../pg-helpers.js");
const { starteTelemetrie } = await import("../../src/utils/telemetrie.js");
const { makeOnboardRoutes } = await import("../../src/routes/api-onboard.js");
const { handleProvisionJob } = await import("../../src/worker/provisioning.js");
const { voiceControl, messaging, numberProvisioning, providerConfigRead } = await import(
  "../../src/telephony/registry.js"
);

after(() => new Promise((fertig) => telnyxStub.close(fertig)));

function startEmpfaenger() {
  const empfangen = [];
  const wartende = [];
  const empfaenger = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      empfangen.push(JSON.parse(Buffer.concat(teile).toString("utf8")));
      for (const wartender of wartende.splice(0)) wartender();
      res.writeHead(HTTP_OK, { "content-type": "application/json" }).end("{}");
    });
  });
  return new Promise((resolve) => {
    empfaenger.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${empfaenger.address().port}/otlp`;
      resolve({ url, empfangen, wartende, stop: () => new Promise((fertig) => empfaenger.close(fertig)) });
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
const dauerPunkte = (exporte) =>
  metrikenVon(exporte, DAUER).flatMap((m) =>
    m.histogram.dataPoints.map((p) => ({ attribute: attribute(p), anzahl: Number(p.count), summe: p.sum })),
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

function einrichtungOhneHold(store) {
  const lauf = { fertig: null };
  const bereit = new Promise((resolve) => {
    lauf.fertig = resolve;
  });
  const provisioning = {
    queueProvisioning: async () => ({ ok: true, jobId: "job_messung" }),
    runProvisioningDrainExclusive: async () => {
      const state = store.load();
      const nummer = state.numbers.find((n) => n.status === "requested");
      const auftrag = { payload: { numberId: nummer.id } };
      const optionen = { countryCode: "US", holdAmountCents: 0, currency: "EUR" };
      await handleProvisionJob(state, auftrag, { provisioner: numberProvisioning() }, optionen).catch(() => {});
      lauf.fertig();
    },
  };
  return { provisioning, bereit };
}

async function einrichtungStarten() {
  const { store } = await makePgTestStore();
  const { provisioning, bereit } = einrichtungOhneHold(store);
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store,
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
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "t_messung" }),
    });
    const { numberId, jobId, ...rest } = await res.json();
    await bereit;
    return { status: res.status, koerper: rest, hatKennungen: Boolean(numberId && jobId) };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function einrichtungMitMessung(antwort) {
  telnyxAntwort = { verzoegerungMs: 0, ...antwort };
  return mitTelemetrie(async ({ telemetrie, empfaenger }) => {
    const antwortAnKunde = await einrichtungStarten();
    await telemetrie.spuele();
    return { antwortAnKunde, exporte: empfaenger.empfangen };
  });
}

async function einrichtungOhneMessung(antwort) {
  telnyxAntwort = { verzoegerungMs: 0, ...antwort };
  return einrichtungStarten();
}

const SUCHE_OK = { status: HTTP_OK, koerper: { data: [] } };
const SUCHE_429 = { status: HTTP_ZU_VIELE, koerper: { errors: [{ code: "99999", title: "Rate limit" }] } };

test("S1: eine erfolgreiche Nummernsuche zaehlt telnyx/nummern-suchen/ok genau einmal", async () => {
  const { exporte } = await einrichtungMitMessung(SUCHE_OK);
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "telnyx", vorgang: "nummern-suchen", ergebnis: "ok", wert: 1 },
  ]);
});

test("S2: eine Antwort 429 zaehlt als ergebnis 429", async () => {
  const { exporte } = await einrichtungMitMessung(SUCHE_429);
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "telnyx", vorgang: "nummern-suchen", ergebnis: "429", wert: 1 },
  ]);
});

test("S8: ein 500 mit '429' im Fehlertext zaehlt als fehler, nicht als 429, und die Nummer steht nirgends im Export", async () => {
  const text = `Number ${NUMMER_IM_FEHLERTEXT} not available, code 429`;
  const { exporte } = await einrichtungMitMessung({
    status: HTTP_FEHLER,
    koerper: { errors: [{ code: "20000", title: text }] },
  });
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "telnyx", vorgang: "nummern-suchen", ergebnis: "fehler", wert: 1 },
  ]);
  assert.ok(!JSON.stringify(exporte).includes(NUMMER_IM_FEHLERTEXT));
});

test("S6: die Dauer einer langsamen Antwort steht im Histogramm nach anbieter und vorgang", async () => {
  const { exporte } = await einrichtungMitMessung({ ...SUCHE_OK, verzoegerungMs: LANGSAME_ANTWORT_MS });
  const [dauerMetrik] = metrikenVon(exporte, DAUER);
  assert.equal(dauerMetrik.unit, "ms");
  const [erstesPunkt] = dauerMetrik.histogram.dataPoints;
  assert.equal(erstesPunkt.explicitBounds.length, ERWARTETE_GRENZEN);
  const [punkt, ...weitere] = dauerPunkte(exporte);
  assert.equal(weitere.length, 0);
  assert.deepEqual(punkt.attribute, { anbieter: "telnyx", vorgang: "nummern-suchen" });
  assert.equal(punkt.anzahl, 1);
  assert.ok(punkt.summe >= LANGSAME_ANTWORT_MS && punkt.summe < OBERGRENZE_DAUER_MS, `Summe ${punkt.summe}`);
});

test("B1: bei 429 ist die Antwort an den Kunden mit und ohne Messung gleich", async () => {
  const ohne = await einrichtungOhneMessung(SUCHE_429);
  const { antwortAnKunde } = await einrichtungMitMessung(SUCHE_429);
  assert.equal(ohne.status, HTTP_OK);
  assert.equal(ohne.koerper.provisioning, "queued");
  assert.deepEqual(antwortAnKunde, ohne);
});

test("B2: wirft das Erfassen bei jedem Messwert, ist die Antwort an den Kunden gleich", async () => {
  const ohne = await einrichtungOhneMessung(SUCHE_OK);
  const mitAusfall = await mitTelemetrie(async ({ telemetrie }) => {
    const erfassen = mock.method(telemetrie, "messeAnbieter", () => {
      throw new Error("Erfassen kaputt");
    });
    telnyxAntwort = { verzoegerungMs: 0, ...SUCHE_OK };
    const warnung = mock.method(console, "warn", () => {});
    const antwortAnKunde = await einrichtungStarten();
    const warnungen = warnung.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
    warnung.mock.restore();
    return { antwortAnKunde, versuche: erfassen.mock.callCount(), warnungen };
  });
  assert.equal(mitAusfall.versuche, 1);
  assert.equal(mitAusfall.warnungen.length, 1);
  assert.match(mitAusfall.warnungen[0], /anbieter=telnyx vorgang=nummern-suchen/);
  assert.ok(!mitAusfall.warnungen[0].includes("Erfassen kaputt"));
  assert.deepEqual(mitAusfall.antwortAnKunde, ohne);
});

test("B4: ein Status-Webhook CallStatus=completed erzeugt keinen Telnyx-Zaehler", async () => {
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({
    env: {
      METRIKEN_OTLP_URL: empfaenger.url,
      METRIKEN_OTLP_BENUTZER: BENUTZER,
      METRIKEN_OTLP_TOKEN: TOKEN,
      METRIKEN_INTERVALL_MS: "50",
    },
  });
  try {
    const gesehen = new Promise((resolve) => {
      const pruefen = () => {
        const mitStatusRoute = JSON.stringify(empfaenger.empfangen).includes("/voice/status");
        if (mitStatusRoute) resolve();
        else empfaenger.wartende.push(pruefen);
      };
      pruefen();
    });
    const res = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=call_messung`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: "completed" }),
    });
    assert.equal(res.status, HTTP_OK);
    await gesehen;
    assert.deepEqual(zaehlerPunkte(empfaenger.empfangen), []);
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
});

const VORGAENGE = [
  ["anruf-starten", () => voiceControl("telnyx").originateCall({})],
  ["anruf-beenden", () => voiceControl("telnyx").endCall("CAx")],
  ["anruf-beenden-callcontrol", () => voiceControl("telnyx").endCallViaCallControl("ccx")],
  ["anruf-umleiten", () => voiceControl("telnyx").redirectCall("CAx", "https://example.test/x")],
  ["sms-senden", () => messaging("telnyx").sendSms({ from: "+1", to: "+2", body: "x" })],
  ["nummern-suchen", () => numberProvisioning("telnyx").searchNumbers({ countryCode: "US" })],
  ["nummer-kaufen", () => numberProvisioning("telnyx").orderNumber({ e164: "+12025550100" })],
  ["nummer-freigeben", () => numberProvisioning("telnyx").releaseNumber("pn_x")],
  ["nummer-nachschlagen", () => providerConfigRead("telnyx").findPhoneNumber("+12025550100")],
];

test("R3: jede gemessene Telnyx-Methode zaehlt unter ihrem festen Vorgangsnamen", async () => {
  telnyxAntwort = { verzoegerungMs: 0, ...SUCHE_OK };
  const exporte = await mitTelemetrie(async ({ telemetrie, empfaenger }) => {
    for (const [, aufruf] of VORGAENGE) await Promise.resolve(aufruf()).catch(() => {});
    await telemetrie.spuele();
    return empfaenger.empfangen;
  });
  const gezaehlt = zaehlerPunkte(exporte).map((p) => p.vorgang).sort();
  assert.deepEqual(gezaehlt, VORGAENGE.map(([name]) => name).sort());
  for (const punkt of zaehlerPunkte(exporte)) assert.equal(punkt.anbieter, "telnyx");
});

test("Rueckgabe und Fehler: die Huelle gibt dieselbe Antwort und denselben Fehlerwert weiter", async () => {
  telnyxAntwort = { verzoegerungMs: 0, status: HTTP_OK, koerper: { data: [{ phone_number: "+12025550100" }] } };
  const treffer = await numberProvisioning("telnyx").searchNumbers({ countryCode: "US" });
  assert.deepEqual(treffer, [{ e164: "+12025550100" }]);
  telnyxAntwort = { verzoegerungMs: 0, ...SUCHE_429 };
  const fehler = await numberProvisioning("telnyx")
    .searchNumbers({ countryCode: "US" })
    .catch((err) => err);
  assert.equal(fehler.providerStatus, HTTP_ZU_VIELE);
  assert.match(fehler.message, /^Telnyx searchNumbers fehlgeschlagen: HTTP 429/);
});

async function mitFetchFehler(wert, aufruf) {
  return mitTelemetrie(async ({ telemetrie, empfaenger }) => {
    const geworfen = await withFetch(() => Promise.reject(wert), () =>
      aufruf().then(
        () => "kein Fehler",
        (fehler) => fehler,
      ),
    );
    await telemetrie.spuele();
    return { geworfen, exporte: empfaenger.empfangen };
  });
}

const sucheUS = () => numberProvisioning("telnyx").searchNumbers({ countryCode: "US" });

test("Zeitueberschreitung: ein TimeoutError der Anfrage zaehlt als zeitueberschreitung und wird unveraendert weitergeworfen", async () => {
  const frist = new DOMException("Frist", "TimeoutError");
  const { geworfen, exporte } = await mitFetchFehler(frist, sucheUS);
  assert.equal(geworfen, frist);
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "telnyx", vorgang: "nummern-suchen", ergebnis: "zeitueberschreitung", wert: 1 },
  ]);
});

test("Ein Fehler ohne Name TimeoutError und ohne Status zaehlt als fehler", async () => {
  const abbruch = new DOMException("Abbruch", "AbortError");
  const { geworfen, exporte } = await mitFetchFehler(abbruch, sucheUS);
  assert.equal(geworfen, abbruch);
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "telnyx", vorgang: "nummern-suchen", ergebnis: "fehler", wert: 1 },
  ]);
});

test("Ein Fehlerwert ohne Eigenschaften wird unveraendert weitergeworfen und als fehler gezaehlt", async () => {
  const { geworfen, exporte } = await mitFetchFehler(null, sucheUS);
  assert.equal(geworfen, null);
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "telnyx", vorgang: "nummern-suchen", ergebnis: "fehler", wert: 1 },
  ]);
});

test("Drosselcode: beim Nummernkauf zaehlt 429 mit Telnyx-Code 10011 (ohne Status am Fehler) als 429, ohne den Code als fehler", async () => {
  const kaufen = () => numberProvisioning("telnyx").orderNumber({ e164: "+12025550100", idempotencyKey: "order_x" });
  telnyxAntwort = { verzoegerungMs: 0, status: HTTP_ZU_VIELE, koerper: { errors: [{ code: "10011", title: "Rate limit" }] } };
  const mitCode = await mitTelemetrie(async ({ telemetrie, empfaenger }) => {
    await kaufen().catch(() => {});
    await telemetrie.spuele();
    return empfaenger.empfangen;
  });
  assert.deepEqual(zaehlerPunkte(mitCode), [
    { anbieter: "telnyx", vorgang: "nummer-kaufen", ergebnis: "429", wert: 1 },
  ]);
  telnyxAntwort = { verzoegerungMs: 0, status: HTTP_ZU_VIELE, koerper: { errors: [{ code: "99999", title: "Rate limit" }] } };
  const ohneCode = await mitTelemetrie(async ({ telemetrie, empfaenger }) => {
    await kaufen().catch(() => {});
    await telemetrie.spuele();
    return empfaenger.empfangen;
  });
  assert.deepEqual(zaehlerPunkte(ohneCode), [
    { anbieter: "telnyx", vorgang: "nummer-kaufen", ergebnis: "fehler", wert: 1 },
  ]);
});

test("SMS und Nummernnachschlag: ein 429 von Telnyx zaehlt bei beiden als 429", async () => {
  telnyxAntwort = { verzoegerungMs: 0, ...SUCHE_429 };
  const exporte = await mitTelemetrie(async ({ telemetrie, empfaenger }) => {
    await messaging("telnyx").sendSms({ from: "+1", to: "+2", body: "x" }).catch(() => {});
    await providerConfigRead("telnyx").findPhoneNumber("+12025550100").catch(() => {});
    await telemetrie.spuele();
    return empfaenger.empfangen;
  });
  const punkte = zaehlerPunkte(exporte).sort((a, b) => a.vorgang.localeCompare(b.vorgang));
  assert.deepEqual(punkte, [
    { anbieter: "telnyx", vorgang: "nummer-nachschlagen", ergebnis: "429", wert: 1 },
    { anbieter: "telnyx", vorgang: "sms-senden", ergebnis: "429", wert: 1 },
  ]);
});

test("Nur gelistete Methoden bekommen eine Huelle, fehlende bleiben fehlend", () => {
  assert.equal(messaging("telnyx").originateCall, undefined);
  assert.equal(voiceControl("telnyx").sendSms, undefined);
});

test("Nach stoppe erreicht kein Aufruf mehr die beendete Messung", async () => {
  const beendete = await mitTelemetrie(async ({ telemetrie }) => ({ telemetrie }));
  const erfassen = mock.method(beendete.telemetrie, "messeAnbieter");
  telnyxAntwort = { verzoegerungMs: 0, ...SUCHE_OK };
  await numberProvisioning("telnyx").searchNumbers({ countryCode: "US" });
  assert.equal(erfassen.mock.callCount(), 0);
});
