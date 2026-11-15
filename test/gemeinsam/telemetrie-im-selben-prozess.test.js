import assert from "node:assert/strict";
import { test, mock } from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";

import { echtWarten } from "../echt-warten.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "./erfundene-geheimnisse.js";
import { startEmpfaenger } from "./otlp-empfaenger.js";
import { starteTelemetrie, anbieterMesser, anfrageMessung, KEINE_TELEMETRIE } from "../../src/utils/telemetrie.js";

const BENUTZER = "123456";
const INSTANZ = "instanz-direkt";
const VERSION = "v-direkt";
const TELEFONNUMMER = "+4915112345678";
const ANFRAGE_DAUER = "hermes.http.server.duration";
const ANBIETER_AUFRUFE = "hermes.anbieter.aufrufe";
const ANBIETER_DAUER = "hermes.anbieter.dauer";
const GRENZEN = [10, 50, 100, 250, 500, 1000, 2500, 10000];
const AUSREICHEND_KURZ_MS = 5000;
const WARTE_FRIST_MS = 30000;
const MINUTE_MS = 60000;
const PRUEFFENSTER_MS = 80;

async function mitTelemetrie(einstellungen, lauf) {
  const empfaenger = await startEmpfaenger();
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    benutzer: BENUTZER,
    token: TOKEN,
    instanzKennung: INSTANZ,
    version: VERSION,
    ...einstellungen,
  });
  try {
    return await lauf({ telemetrie, empfaenger });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
  }
}

const metriken = (exporte) =>
  exporte.flatMap((e) => e.resourceMetrics).flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);
const punkte = (exporte, name) =>
  metriken(exporte)
    .filter((m) => m.name === name)
    .flatMap((m) => (m.histogram ?? m.sum).dataPoints);
const labels = (punkt) => Object.fromEntries(punkt.attributes.map((a) => [a.key, a.value.stringValue]));

function warteAufMetrik(empfaenger, name) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export")));
    const pruefen = () => {
      if (punkte(empfaenger.exporte, name).length) resolve();
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

function messeUeberMiddleware(telemetrie, req, statusCode) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  let weitergereicht = 0;
  anfrageMessung(telemetrie)(req, res, () => {
    weitergereicht += 1;
  });
  res.emit("close");
  return weitergereicht;
}

async function anfrageLabelsFuer(req, statusCode) {
  return mitTelemetrie({}, async ({ telemetrie, empfaenger }) => {
    assert.equal(messeUeberMiddleware(telemetrie, req, statusCode), 1);
    await telemetrie.spuele();
    const [punkt] = punkte(empfaenger.exporte, ANFRAGE_DAUER);
    return labels(punkt);
  });
}

const adresseAktiv = async (url, token = TOKEN) => {
  const telemetrie = await starteTelemetrie({ url, benutzer: BENUTZER, token, instanzKennung: INSTANZ });
  const aktiv = telemetrie.aktiv;
  await telemetrie.stoppe();
  return aktiv;
};

test("Telemetrie direkt: ftp auf Loopback und fremde http-Adressen starten keine Messung", async () => {
  const keine = await starteTelemetrie({ url: "ftp://127.0.0.1:1", token: TOKEN });
  assert.equal(keine, KEINE_TELEMETRIE);
  assert.equal(keine.aktiv, false);
  assert.equal(await adresseAktiv("http://example.com"), false);
  assert.equal(await adresseAktiv("http://user:pw@127.0.0.1"), false);
  assert.equal(await adresseAktiv("https://user:pw@otlp.example.test"), false);
  assert.equal(await adresseAktiv("https://:pw@otlp.example.test"), false);
  assert.equal(await adresseAktiv("kein-url"), false);
  assert.equal(await adresseAktiv(undefined), false);
  assert.equal(await adresseAktiv("http://127.0.0.1:1", ""), false);
  assert.equal((await starteTelemetrie({})).aktiv, false);
});

test("Telemetrie direkt: Loopback per http und jede https-Adresse mit Token starten die Messung", async () => {
  assert.equal(await adresseAktiv("http://127.0.0.1:1"), true);
  assert.equal(await adresseAktiv("http://localhost:1"), true);
  assert.equal(await adresseAktiv("https://otlp.example.test/otlp"), true);
  assert.equal(await adresseAktiv("https://127.0.0.1:1"), true);
});

test("Telemetrie direkt: die Messung ohne Aufbau-Moeglichkeit ist stumm und aus", async () => {
  assert.equal(KEINE_TELEMETRIE.aktiv, false);
  assert.equal(KEINE_TELEMETRIE.messeAnfrage(), undefined);
  assert.equal(KEINE_TELEMETRIE.messeAnbieter(), undefined);
  assert.equal(await KEINE_TELEMETRIE.spuele(), undefined);
  assert.equal(await KEINE_TELEMETRIE.stoppe(), undefined);
  assert.throws(() => {
    KEINE_TELEMETRIE.aktiv = true;
  });
});

test("Telemetrie direkt: die Statusklasse folgt der Hunderterstelle und alles ausserhalb 1xx bis 5xx heisst andere", async () => {
  const faelle = [
    [99, "andere"],
    [100, "1xx"],
    [199, "1xx"],
    [200, "2xx"],
    [301, "3xx"],
    [404, "4xx"],
    [500, "5xx"],
    [599, "5xx"],
    [600, "andere"],
    [0, "andere"],
  ];
  for (const [status, erwartet] of faelle) {
    const gemessen = await anfrageLabelsFuer({ method: "GET", route: { path: "/x" } }, status);
    assert.equal(gemessen.status_class, erwartet, `Status ${status}`);
  }
});

test("Telemetrie direkt: erlaubte Methoden bleiben, TRACE und Kleinschreibung heissen andere", async () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const gemessen = await anfrageLabelsFuer({ method, route: { path: "/x" } }, 200);
    assert.equal(gemessen.method, method);
  }
  for (const method of ["TRACE", "get", undefined]) {
    const gemessen = await anfrageLabelsFuer({ method, route: { path: "/x" } }, 200);
    assert.equal(gemessen.method, "andere");
  }
});

test("Telemetrie direkt: das Routenmuster steht statt des Pfads, ohne Muster steht unbekannt", async () => {
  assert.deepEqual(await anfrageLabelsFuer({ method: "GET", route: { path: "/api/calls/:id" } }, 404), {
    route: "/api/calls/:id",
    method: "GET",
    status_class: "4xx",
  });
  assert.equal((await anfrageLabelsFuer({ method: "GET" }, 404)).route, "unbekannt");
  assert.equal((await anfrageLabelsFuer({ method: "GET", route: {} }, 404)).route, "unbekannt");
  assert.equal((await anfrageLabelsFuer({ method: "GET", route: { path: /^\/x$/ } }, 404)).route, "unbekannt");
});

test("Telemetrie direkt: die Anfrage-Messung exportiert Histogramm in ms mit den acht Grenzen und der gemessenen Dauer", async () => {
  await mitTelemetrie({}, async ({ telemetrie, empfaenger }) => {
    messeUeberMiddleware(telemetrie, { method: "GET", route: { path: "/x" } }, 200);
    await telemetrie.spuele();
    const metrik = metriken(empfaenger.exporte).find((m) => m.name === ANFRAGE_DAUER);
    assert.equal(metrik.unit, "ms");
    const [punkt] = metrik.histogram.dataPoints;
    assert.deepEqual(punkt.explicitBounds, GRENZEN);
    assert.equal(Number(punkt.count), 1);
    assert.ok(punkt.sum >= 0 && punkt.sum < AUSREICHEND_KURZ_MS, `Dauer ${punkt.sum} ms`);
  });
});

test("Telemetrie direkt: die Anfrage-Messung nimmt die Dauer aus dem Aufruf und reicht die Anfrage weiter", async () => {
  await mitTelemetrie({}, async ({ telemetrie, empfaenger }) => {
    telemetrie.messeAnfrage({ route: "/x", method: "GET", status: 200, dauerMs: 120 });
    await telemetrie.spuele();
    const [punkt] = punkte(empfaenger.exporte, ANFRAGE_DAUER);
    assert.equal(punkt.sum, 120);
    assert.equal(punkt.bucketCounts.map(Number).indexOf(1), GRENZEN.indexOf(250));
  });
  const res = new EventEmitter();
  let weiter = 0;
  anfrageMessung(KEINE_TELEMETRIE)({}, res, () => {
    weiter += 1;
  });
  assert.equal(weiter, 1);
  assert.equal(res.listenerCount("close"), 0);
});

test("Telemetrie direkt: die Anbieter-Messung exportiert Zaehler und Dauer-Histogramm mit ihren Labels", async () => {
  await mitTelemetrie({}, async ({ telemetrie, empfaenger }) => {
    anbieterMesser.messeAnbieter({ anbieter: "telnyx", vorgang: "sms", ergebnis: "ok", dauerMs: 75 });
    anbieterMesser.messeAnbieter({ anbieter: "telnyx", vorgang: "sms", ergebnis: "ok", dauerMs: 75 });
    await telemetrie.spuele();
    const [zaehler] = punkte(empfaenger.exporte, ANBIETER_AUFRUFE);
    assert.deepEqual(labels(zaehler), { anbieter: "telnyx", vorgang: "sms", ergebnis: "ok" });
    assert.equal(Number(zaehler.asInt ?? zaehler.asDouble), 2);
    const dauer = metriken(empfaenger.exporte).find((m) => m.name === ANBIETER_DAUER);
    assert.equal(dauer.unit, "ms");
    const [punkt] = dauer.histogram.dataPoints;
    assert.deepEqual(labels(punkt), { anbieter: "telnyx", vorgang: "sms" });
    assert.deepEqual(punkt.explicitBounds, GRENZEN);
    assert.equal(punkt.sum, 150);
    assert.equal(Number(punkt.count), 2);
  });
});

test("Telemetrie direkt: der Export traegt Anmeldung, Pfad /v1/metrics, Dienst, Instanz und Version", async () => {
  const angekommen = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      angekommen.push({ url: req.url, anmeldung: req.headers.authorization, inhalt: req.headers["content-type"] });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  const url = `http://127.0.0.1:${server.address().port}/otlp//`;
  const telemetrie = await starteTelemetrie({ url, benutzer: BENUTZER, token: TOKEN, instanzKennung: INSTANZ, version: VERSION });
  try {
    telemetrie.messeAnbieter({ anbieter: "a", vorgang: "v", ergebnis: "ok", dauerMs: 1 });
    await telemetrie.spuele();
  } finally {
    await telemetrie.stoppe();
    await new Promise((fertig) => server.close(fertig));
  }
  assert.equal(angekommen[0].url, "/otlp/v1/metrics");
  assert.equal(angekommen[0].anmeldung, `Basic ${Buffer.from(`${BENUTZER}:${TOKEN}`).toString("base64")}`);
});

test("Telemetrie direkt: die Ressource nennt service.name hermes, die Instanz und die Version wie uebergeben", async () => {
  await mitTelemetrie({}, async ({ telemetrie, empfaenger }) => {
    telemetrie.messeAnbieter({ anbieter: "a", vorgang: "v", ergebnis: "ok", dauerMs: 1 });
    await telemetrie.spuele();
    const [{ resource }] = empfaenger.exporte[0].resourceMetrics;
    const werte = Object.fromEntries(resource.attributes.map((a) => [a.key, a.value.stringValue]));
    assert.equal(werte["service.name"], "hermes");
    assert.equal(werte["service.instance.id"], INSTANZ);
    assert.equal(werte["service.version"], VERSION);
    const [{ scopeMetrics }] = empfaenger.exporte[0].resourceMetrics;
    assert.equal(scopeMetrics[0].scope.name, "hermes");
  });
});

test("Telemetrie direkt: der Export kommt von selbst im eingestellten Rhythmus an", async () => {
  await mitTelemetrie({ intervallMs: 20 }, async ({ telemetrie, empfaenger }) => {
    telemetrie.messeAnbieter({ anbieter: "a", vorgang: "v", ergebnis: "ok", dauerMs: 1 });
    await warteAufMetrik(empfaenger, ANBIETER_AUFRUFE);
    assert.equal(punkte(empfaenger.exporte, ANBIETER_AUFRUFE).length >= 1, true);
  });
});

test("Telemetrie direkt: eine Telefonnummer in Route oder Anbieter-Label steht nicht im Export", async () => {
  await mitTelemetrie({ intervallMs: 20 }, async ({ telemetrie, empfaenger }) => {
    messeUeberMiddleware(telemetrie, { method: "GET", url: `/voice/${TELEFONNUMMER}/status`, originalUrl: `/voice/${TELEFONNUMMER}` }, 200);
    messeUeberMiddleware(telemetrie, { method: "POST", path: `/api/calls/${TELEFONNUMMER}`, route: { path: "/api/calls/:id" } }, 200);
    telemetrie.messeAnbieter({ anbieter: "telnyx", vorgang: "sms", ergebnis: "ok", dauerMs: 5 });
    await warteAufMetrik(empfaenger, ANFRAGE_DAUER);
    await warteAufMetrik(empfaenger, ANBIETER_AUFRUFE);
    const text = JSON.stringify(empfaenger.exporte);
    assert.equal(text.includes(TELEFONNUMMER), false);
    assert.equal(text.includes(TELEFONNUMMER.slice(1)), false);
    const routen = punkte(empfaenger.exporte, ANFRAGE_DAUER).map((p) => labels(p).route);
    assert.deepEqual([...new Set(routen)].sort(), ["/api/calls/:id", "unbekannt"]);
  });
});

test("Telemetrie direkt: nach stoppe() exportiert der Anbieter-Messer nichts mehr", async () => {
  const empfaenger = await startEmpfaenger();
  const telemetrie = await starteTelemetrie({ url: empfaenger.url, benutzer: BENUTZER, token: TOKEN, instanzKennung: INSTANZ });
  anbieterMesser.messeAnbieter({ anbieter: "a", vorgang: "v", ergebnis: "vor", dauerMs: 1 });
  await telemetrie.stoppe();
  const davor = empfaenger.exporte.length;
  assert.ok(davor >= 1);
  assert.equal(anbieterMesser.messeAnbieter({ anbieter: "a", vorgang: "v", ergebnis: "nach", dauerMs: 1 }), undefined);
  assert.equal(empfaenger.exporte.length, davor);
  assert.equal(JSON.stringify(empfaenger.exporte).includes('"nach"'), false);
  await empfaenger.stop();
});

test("Telemetrie direkt: stoppe() einer abgeloesten Messung laesst die laufende weiter messen", async () => {
  const alt = await starteTelemetrie({ url: "http://127.0.0.1:1", token: TOKEN, instanzKennung: "alt" });
  const empfaenger = await startEmpfaenger();
  const neu = await starteTelemetrie({ url: empfaenger.url, benutzer: BENUTZER, token: TOKEN, instanzKennung: "neu" });
  await alt.stoppe();
  anbieterMesser.messeAnbieter({ anbieter: "a", vorgang: "v", ergebnis: "weiter", dauerMs: 1 });
  await neu.spuele();
  assert.equal(JSON.stringify(empfaenger.exporte).includes('"weiter"'), true);
  await neu.stoppe();
  await empfaenger.stop();
});

test("Telemetrie direkt: ein Exporter, der nicht aufgebaut werden kann, ergibt die stumme Messung mit Warnung", async () => {
  const warnungen = [];
  const original = console.warn;
  console.warn = (text) => warnungen.push(text);
  try {
    const telemetrie = await starteTelemetrie({ url: "https://otlp.example.test", token: TOKEN, instanzKennung: INSTANZ, intervallMs: -1 });
    assert.equal(telemetrie, KEINE_TELEMETRIE);
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnungen, ["[telemetrie] Messwerte aus: Aufbau des Exporters fehlgeschlagen (Error)"]);
});

test("Telemetrie direkt: ohne Angabe exportiert die Messung nach einer Minute und nicht vorher", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    await mitTelemetrie({}, async ({ telemetrie, empfaenger }) => {
      telemetrie.messeAnbieter({ anbieter: "a", vorgang: "v", ergebnis: "ok", dauerMs: 1 });
      mock.timers.tick(MINUTE_MS - 1);
      await echtWarten(PRUEFFENSTER_MS);
      assert.equal(empfaenger.exporte.length, 0);
      mock.timers.tick(1);
      await warteAufMetrik(empfaenger, ANBIETER_AUFRUFE);
      assert.equal(empfaenger.exporte.length, 1);
    });
  } finally {
    mock.timers.reset();
  }
});
