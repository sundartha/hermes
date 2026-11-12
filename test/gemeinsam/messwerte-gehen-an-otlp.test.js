import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { echtWarten } from "../echt-warten.js";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";

const TELEFONNUMMER = "4915112345678";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "./erfundene-geheimnisse.js";
const BENUTZER = "123456";
const INSTANZ = "instanz-test";
const COMMIT = "abc1234";
const ERLAUBTE_LABELS = ["method", "route", "status_class"];
const SERIEN_BUDGET_JE_INSTANZ = 3000;
const SERIEN_JE_HISTOGRAMM_OHNE_GRENZEN = 3;
const ERWARTETE_GRENZEN = 8;
const EXPORT_INTERVALL_MS = "50";
const WARTE_FRIST_MS = 8000;
const FREMDE_PFADE = 150;
const KEINE_AUSFUHR_PRUEFFENSTER_MS = 80;

function startEmpfaenger() {
  const empfangen = [];
  const wartende = [];
  const empfaenger = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      const eintrag = { url: req.url, anmeldung: req.headers.authorization, text: Buffer.concat(teile).toString("utf8") };
      empfangen.push(eintrag);
      for (const wartender of wartende.splice(0)) wartender();
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  return new Promise((resolve) => {
    empfaenger.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${empfaenger.address().port}/otlp`;
      resolve({ url, empfangen, wartende, stop: () => new Promise((fertig) => empfaenger.close(fertig)) });
    });
  });
}

function warteAufExport(empfaenger, pruefung) {
  const letzter = () => empfaenger.empfangen.map((e) => JSON.parse(e.text)).findLast(pruefung);
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export empfangen")));
    const pruefen = () => {
      const treffer = letzter();
      if (treffer) {
        resolve(treffer);
        return;
      }
      empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

const punkteVon = (export_) =>
  export_.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics.flatMap((m) => m.histogram?.dataPoints ?? [])));
const attribute = (punkt) => Object.fromEntries(punkt.attributes.map((a) => [a.key, a.value.stringValue]));

async function mitMessung(umgebung, lauf) {
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({
    env: {
      METRIKEN_OTLP_URL: empfaenger.url,
      METRIKEN_OTLP_BENUTZER: BENUTZER,
      METRIKEN_OTLP_TOKEN: TOKEN,
      METRIKEN_INTERVALL_MS: EXPORT_INTERVALL_MS,
      RENDER_INSTANCE_ID: INSTANZ,
      RENDER_GIT_COMMIT: COMMIT,
      ...umgebung,
    },
  });
  try {
    return await lauf({ srv, empfaenger });
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
}

const hatRoute = (route) => (export_) => punkteVon(export_).some((p) => attribute(p).route === route);

test("Messwerte: der Export kommt mit Anmeldung am Pfad /v1/metrics an und nennt Dienst, Instanz und Version", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    await abrufMitFrist(`${srv.localUrl}/healthz`);
    const export_ = await warteAufExport(empfaenger, hatRoute("/healthz"));
    const [anfrage] = empfaenger.empfangen;
    assert.equal(anfrage.url, "/otlp/v1/metrics");
    assert.equal(anfrage.anmeldung, `Basic ${Buffer.from(`${BENUTZER}:${TOKEN}`).toString("base64")}`);
    const [{ resource }] = export_.resourceMetrics;
    const werte = Object.fromEntries(resource.attributes.map((a) => [a.key, a.value.stringValue]));
    assert.equal(werte["service.name"], "hermes");
    assert.equal(werte["service.instance.id"], INSTANZ);
    assert.equal(werte["service.version"], COMMIT);
  });
});

test("Messwerte: nur erlaubte Labels, das Routenmuster steht statt des Pfads", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    await abrufMitFrist(`${srv.localUrl}/healthz`);
    await abrufMitFrist(`${srv.localUrl}/api/calls/call_geheim`);
    await abrufMitFrist(`${srv.localUrl}/gibt-es-nicht`, { method: "POST" });
    const export_ = await warteAufExport(empfaenger, (e) => ["/healthz", "/api/calls/:id", "unbekannt"].every((r) => hatRoute(r)(e)));
    const attributeAlle = punkteVon(export_).map(attribute);
    for (const eins of attributeAlle) assert.deepEqual(Object.keys(eins).sort(), ERLAUBTE_LABELS);
    const unbekannt = attributeAlle.find((a) => a.route === "unbekannt");
    assert.equal(unbekannt.method, "POST");
    assert.equal(unbekannt.status_class, "4xx");
  });
});

test("Messwerte: eine unbekannte HTTP-Methode wird als andere gezaehlt", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    await abrufMitFrist(`${srv.localUrl}/healthz`, { method: "PROPFIND" });
    const export_ = await warteAufExport(empfaenger, hatRoute("unbekannt"));
    const methoden = punkteVon(export_).map((p) => attribute(p).method);
    assert.deepEqual(methoden, ["andere"]);
  });
});

test("Messwerte: eine Telefonnummer im Pfad erscheint nirgends im Export", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    await abrufMitFrist(`${srv.localUrl}/voice/+${TELEFONNUMMER}/status`);
    await abrufMitFrist(`${srv.localUrl}/api/calls/${TELEFONNUMMER}`);
    await warteAufExport(empfaenger, hatRoute("unbekannt"));
    await warteAufExport(empfaenger, hatRoute("/api/calls/:id"));
    for (const eintrag of empfaenger.empfangen) assert.ok(!eintrag.text.includes(TELEFONNUMMER), "keine Nummer im Export");
  });
});

test("Messwerte: das Histogramm der Antwortdauer hat genau 8 Grenzen", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    await abrufMitFrist(`${srv.localUrl}/healthz`);
    const export_ = await warteAufExport(empfaenger, hatRoute("/healthz"));
    for (const punkt of punkteVon(export_)) assert.equal(punkt.explicitBounds.length, ERWARTETE_GRENZEN);
  });
});

test("Messwerte: Serienzahl bei festem Testverkehr liegt unter dem Budget", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    const pfade = ["/healthz", "/api/plans", "/.well-known/security.txt", "/api/calls/call_1", "/api/calls/call_2/cancel"];
    for (const pfad of pfade) await abrufMitFrist(`${srv.localUrl}${pfad}`);
    for (let nr = 0; nr < FREMDE_PFADE; nr += 1) {
      await abrufMitFrist(`${srv.localUrl}/voice/+49151${nr}/x${nr}`, { method: nr % 2 ? "GET" : "POST" });
    }
    const export_ = await warteAufExport(empfaenger, (e) => punkteVon(e).reduce((summe, p) => summe + Number(p.count), 0) >= pfade.length + FREMDE_PFADE);
    const serien = punkteVon(export_).length * (ERWARTETE_GRENZEN + SERIEN_JE_HISTOGRAMM_OHNE_GRENZEN);
    assert.ok(serien < SERIEN_BUDGET_JE_INSTANZ, `${serien} Serien, Budget ${SERIEN_BUDGET_JE_INSTANZ}`);
    assert.ok(punkteVon(export_).length <= pfade.length + 2 * 2, "fremde Pfade bilden nur wenige Reihen");
  });
});

test("Messwerte: ohne Token oder ohne TLS-Adresse sendet der Server nichts", async () => {
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({
    env: { METRIKEN_OTLP_URL: empfaenger.url, METRIKEN_OTLP_TOKEN: "", METRIKEN_INTERVALL_MS: EXPORT_INTERVALL_MS },
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.equal(antwort.status, 200);
    await echtWarten(KEINE_AUSFUHR_PRUEFFENSTER_MS);
    assert.equal(empfaenger.empfangen.length, 0);
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
});

import express from "express";

import { installGlobalMiddleware } from "../../src/app.js";
import { externalIp } from "../helpers.js";
import { mitRoutenServer } from "../anrufe/routen-server.js";

const KENNUNG_HEADER = "x-request-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HTTP_OK = 200;
const UNERREICHBARES_LIMIT_PRO_MIN = 1000;
const KONFIG_OHNE_TELEMETRIE = Object.freeze({ safety: Object.freeze({ rateLimitPerMin: UNERREICHBARES_LIMIT_PRO_MIN }) });

async function zaehlenderEmpfaengerAuf(adresse) {
  const anfragen = [];
  const empfaenger = http.createServer((req, res) => {
    anfragen.push(req.url);
    res.end("{}");
  });
  await new Promise((lauscht) => empfaenger.listen(0, adresse, lauscht));
  return {
    url: `http://${adresse}:${empfaenger.address().port}/otlp`,
    anfragen,
    stop: () => new Promise((fertig) => empfaenger.close(fertig)),
  };
}

test("[NIE1] mit Token, aber unverschluesselter Adresse ausserhalb von Loopback, sendet der Server nichts", async () => {
  const externeAdresse = externalIp();
  assert.ok(externeAdresse, "keine Netzwerkadresse ausser Loopback fuer den Empfaenger");
  const fremderEmpfaenger = await zaehlenderEmpfaengerAuf(externeAdresse);
  try {
    await mitMessung({ METRIKEN_OTLP_URL: fremderEmpfaenger.url }, async ({ srv, empfaenger }) => {
      const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
      assert.equal(antwort.status, HTTP_OK);
      await echtWarten(KEINE_AUSFUHR_PRUEFFENSTER_MS);
      assert.deepEqual(fremderEmpfaenger.anfragen, [], "kein Export ueber unverschluesseltes HTTP");
      assert.equal(empfaenger.empfangen.length, 0);
    });
  } finally {
    await fremderEmpfaenger.stop();
  }
});

test("[NIE2] mit eingeschalteter Messung traegt jede Antwort ihre eigene Anfrage-Kennung und die Sicherheitskoepfe", async () => {
  await mitMessung({}, async ({ srv }) => {
    const bekannt = await abrufMitFrist(`${srv.localUrl}/healthz`);
    const unbekannt = await abrufMitFrist(`${srv.localUrl}/gibt-es-nicht`, { method: "POST" });
    const kaputterKoerper = await abrufMitFrist(`${srv.localUrl}/api/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{kein json",
    });
    const antworten = [bekannt, unbekannt, kaputterKoerper];
    for (const antwort of antworten) {
      assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
      assert.equal(antwort.headers.get("x-content-type-options"), "nosniff");
    }
    const kennungen = new Set(antworten.map((antwort) => antwort.headers.get(KENNUNG_HEADER)));
    assert.equal(kennungen.size, antworten.length);
  });
});

test("[NIE3] eine Telefonnummer in Pfad oder Anfrageparameter erscheint in keinem Export", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    await abrufMitFrist(`${srv.localUrl}/api/calls/call_1?to=%2B${TELEFONNUMMER}`);
    await abrufMitFrist(`${srv.localUrl}/voice/${TELEFONNUMMER}`, { method: "POST" });
    await warteAufExport(empfaenger, hatRoute("unbekannt"));
    await warteAufExport(empfaenger, hatRoute("/api/calls/:id"));
    for (const eintrag of empfaenger.empfangen) {
      assert.ok(!eintrag.text.includes(TELEFONNUMMER), "keine Telefonnummer im Export");
    }
  });
});

test("[NIE4] installGlobalMiddleware ohne telemetrie beantwortet Anfragen weiter normal", async () => {
  const router = express.Router();
  installGlobalMiddleware({ app: router, config: KONFIG_OHNE_TELEMETRIE });
  router.get("/antwort", (_req, res) => res.send("normal beantwortet"));
  await mitRoutenServer(router, async (url) => {
    const antwort = await abrufMitFrist(`${url}/antwort`);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(await antwort.text(), "normal beantwortet");
    assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
  });
});

import { postTelnyxIncoming, waitForLog } from "../helpers.js";
import { startHermesMitAnmeldung } from "../sicherheit/hermes-mit-anmeldung.js";

const NUR_LEERZEICHEN = "   ";
const WEBHOOK_ZEILE_MIT_KENNUNG = /^rid=(\S+) \[voice-antwort\] weg=\/voice\/incoming /m;

test("[NIE1] ein Token nur aus Leerzeichen zaehlt als fehlend, der Server sendet nichts", async () => {
  await mitMessung({ METRIKEN_OTLP_TOKEN: NUR_LEERZEICHEN }, async ({ srv, empfaenger }) => {
    const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.equal(antwort.status, HTTP_OK);
    await echtWarten(KEINE_AUSFUHR_PRUEFFENSTER_MS);
    assert.equal(empfaenger.empfangen.length, 0, "kein Export ohne echtes Token");
  });
});

test("[NIE2] mit Messung steht vor der Webhook-Logzeile dieselbe Kennung wie in der Antwort", async () => {
  await mitMessung({ LOG_REQUEST_ID: "true" }, async ({ srv }) => {
    const antwort = await postTelnyxIncoming(srv, { callSid: "CAmessung" });
    const kennung = antwort.headers.get(KENNUNG_HEADER);
    assert.match(kennung, UUID);
    await waitForLog(srv, WEBHOOK_ZEILE_MIT_KENNUNG);
    const [, kennungImLog] = srv.stdout.match(WEBHOOK_ZEILE_MIT_KENNUNG);
    assert.equal(kennungImLog, kennung);
  });
});

test("[NIE3] eine Telefonnummer in Anfragekoerper oder Kopfzeile erscheint in keinem Export", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    await abrufMitFrist(`${srv.localUrl}/api/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", referer: `https://beispiel.invalid/+${TELEFONNUMMER}` },
      body: JSON.stringify({ to: `+${TELEFONNUMMER}` }),
    });
    await warteAufExport(empfaenger, (e) => punkteVon(e).some((p) => attribute(p).method === "POST"));
    for (const eintrag of empfaenger.empfangen) {
      assert.ok(!eintrag.text.includes(TELEFONNUMMER), "keine Telefonnummer aus Koerper oder Kopfzeile im Export");
    }
  });
});

test("[NIE4] buildApp ohne telemetrie beantwortet Anfragen weiter normal", async (t) => {
  const hermes = await startHermesMitAnmeldung(t);
  const antwort = await abrufMitFrist(`${hermes.url}/healthz`);
  assert.equal(antwort.status, HTTP_OK);
  assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
});

import net from "node:net";

const ADRESSE_NACH_HOST = "Adresse wird nicht nach dem Host beurteilt";
const FREMDER_NAME = "fremd";
const FREMDES_PASSWORT = "geheim";
const LOOPBACK_ANGABE_PORT = 1;

async function startVerbindungszaehler() {
  const verbindungen = [];
  const zaehler = net.createServer((verbindung) => {
    verbindungen.push(verbindung.remotePort);
    verbindung.destroy();
  });
  await new Promise((lauscht) => zaehler.listen(0, "127.0.0.1", lauscht));
  return {
    port: zaehler.address().port,
    verbindungen,
    ersteVerbindung: async () => {
      if (verbindungen.length === 0) await once(zaehler, "connection", { signal: AbortSignal.timeout(WARTE_FRIST_MS) });
    },
    stop: () => new Promise((fertig) => zaehler.close(fertig)),
  };
}

async function keinVerbindungsversuch(adresseMit, begruendung) {
  const zaehler = await startVerbindungszaehler();
  try {
    await mitMessung({ METRIKEN_OTLP_URL: adresseMit(zaehler.port) }, async ({ srv }) => {
      const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
      assert.equal(antwort.status, HTTP_OK);
      await echtWarten(KEINE_AUSFUHR_PRUEFFENSTER_MS);
      assert.deepEqual(zaehler.verbindungen, [], `${ADRESSE_NACH_HOST}: ${begruendung}`);
    });
  } finally {
    await zaehler.stop();
  }
}

test("Messwerte: eine https-Adresse mit Benutzerangabe startet die Messung nicht", async () => {
  await keinVerbindungsversuch(
    (port) => `https://${FREMDER_NAME}:${FREMDES_PASSWORT}@127.0.0.1:${port}/otlp`,
    "https mit Benutzerangabe",
  );
});

test("Messwerte: eine Adresse mit nur einem Passwort startet die Messung nicht", async () => {
  await keinVerbindungsversuch(
    (port) => `https://:${FREMDES_PASSWORT}@127.0.0.1:${port}/otlp`,
    "nur Passwort",
  );
});

test("Messwerte: Loopback-Anfang mit anderem Host hinter der Benutzerangabe startet die Messung nicht", async () => {
  const externeAdresse = externalIp();
  assert.ok(externeAdresse, "keine Netzwerkadresse ausser Loopback fuer den Empfaenger");
  for (const anfang of ["127.0.0.1", "localhost"]) {
    const fremderEmpfaenger = await zaehlenderEmpfaengerAuf(externeAdresse);
    try {
      const adresse = `http://${anfang}:${LOOPBACK_ANGABE_PORT}@${externeAdresse}:${new URL(fremderEmpfaenger.url).port}/otlp`;
      await mitMessung({ METRIKEN_OTLP_URL: adresse }, async ({ srv }) => {
        await abrufMitFrist(`${srv.localUrl}/healthz`);
        await echtWarten(KEINE_AUSFUHR_PRUEFFENSTER_MS);
        assert.deepEqual(fremderEmpfaenger.anfragen, [], `${ADRESSE_NACH_HOST}: ${anfang} als Benutzerangabe`);
      });
    } finally {
      await fremderEmpfaenger.stop();
    }
  }
});

test("Messwerte: eine unlesbare https-Adresse laesst den Server starten und /healthz antwortet", async () => {
  let srv;
  try {
    srv = await startServer({
      env: {
        METRIKEN_OTLP_URL: "https://bei spiel.invalid/otlp",
        METRIKEN_OTLP_BENUTZER: BENUTZER,
        METRIKEN_OTLP_TOKEN: TOKEN,
        METRIKEN_INTERVALL_MS: EXPORT_INTERVALL_MS,
      },
    });
  } catch (fehler) {
    assert.fail(`${ADRESSE_NACH_HOST}: ${fehler.message}`);
  }
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.equal(antwort.status, HTTP_OK, ADRESSE_NACH_HOST);
  } finally {
    await srv.stop();
  }
});

test("[NIE1] eine https-Adresse und localhost ueber http, beide ohne Benutzerangabe, starten die Messung", async () => {
  const zaehler = await startVerbindungszaehler();
  try {
    await mitMessung({ METRIKEN_OTLP_URL: `https://127.0.0.1:${zaehler.port}/otlp` }, async ({ srv }) => {
      await abrufMitFrist(`${srv.localUrl}/healthz`);
      await assert.doesNotReject(zaehler.ersteVerbindung(), "https ohne Benutzerangabe baut eine Verbindung auf");
    });
  } finally {
    await zaehler.stop();
  }
  const lokal = await startEmpfaenger();
  try {
    const ueberLocalhost = lokal.url.replace("127.0.0.1", "localhost");
    await mitMessung({ METRIKEN_OTLP_URL: ueberLocalhost }, async ({ srv }) => {
      await abrufMitFrist(`${srv.localUrl}/healthz`);
      await warteAufExport(lokal, hatRoute("/healthz"));
    });
  } finally {
    await lokal.stop();
  }
});

test("[NIE2] ohne Adresse laeuft der Server weiter und sendet nichts", async () => {
  await mitMessung({ METRIKEN_OTLP_URL: "" }, async ({ srv, empfaenger }) => {
    const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.equal(antwort.status, HTTP_OK);
    await echtWarten(KEINE_AUSFUHR_PRUEFFENSTER_MS);
    assert.equal(empfaenger.empfangen.length, 0);
  });
});

test("[NIE3] eine Adresse ohne http- oder https-Anfang und eine externe http-Adresse senden nichts", async () => {
  await keinVerbindungsversuch((port) => `127.0.0.1:${port}/otlp`, "ohne Anfang");
  await keinVerbindungsversuch((port) => `ftp://127.0.0.1:${port}/otlp`, "ftp-Anfang");
  const externeAdresse = externalIp();
  assert.ok(externeAdresse, "keine Netzwerkadresse ausser Loopback fuer den Empfaenger");
  const fremderEmpfaenger = await zaehlenderEmpfaengerAuf(externeAdresse);
  try {
    await mitMessung({ METRIKEN_OTLP_URL: fremderEmpfaenger.url }, async ({ srv }) => {
      await abrufMitFrist(`${srv.localUrl}/healthz`);
      await echtWarten(KEINE_AUSFUHR_PRUEFFENSTER_MS);
      assert.deepEqual(fremderEmpfaenger.anfragen, [], "kein Export ueber externes http");
    });
  } finally {
    await fremderEmpfaenger.stop();
  }
});

test("[NIE4] die Telefonnummer steht nicht im Export, nachdem beide Routen exportiert sind", async () => {
  await mitMessung({}, async ({ srv, empfaenger }) => {
    await abrufMitFrist(`${srv.localUrl}/voice/+${TELEFONNUMMER}/status`);
    await abrufMitFrist(`${srv.localUrl}/api/calls/${TELEFONNUMMER}`);
    await warteAufExport(empfaenger, (e) => ["/api/calls/:id", "unbekannt"].every((route) => hatRoute(route)(e)));
    for (const eintrag of empfaenger.empfangen) {
      assert.ok(!eintrag.text.includes(TELEFONNUMMER), "keine Nummer im Export");
    }
  });
});

import os from "node:os";
import { EventEmitter, once } from "node:events";

import { KEINE_TELEMETRIE, anfrageMessung, starteTelemetrie } from "../../src/utils/telemetrie.js";

const ERLAUBTE_METHODEN = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const NICHT_ERLAUBTE_METHODE = "TRACE";
const STATUS_UND_KLASSE = [
  [99, "andere"],
  [100, "1xx"],
  [200, "2xx"],
  [404, "4xx"],
  [500, "5xx"],
  [599, "5xx"],
  [600, "andere"],
];
const VERZOEGERUNG_MS = 30;
const MINDEST_DAUER_MS = 25;
const HOECHST_DAUER_MS = 10_000;
const STANDARD_INTERVALL_MS = 60_000;
const KONFIG_INTERVALL_MS = 5000;
const UNTER_MINIMUM_INTERVALL_MS = 1;
const MINIMUM_INTERVALL_MS = 10;
const ADRESSE_MIT_SCHRAEGSTRICHEN = "///";
const ANMELDUNG_OHNE_BENUTZER = `Basic ${Buffer.from(`:${TOKEN}`).toString("base64")}`;

async function mitDirekterMessung(optionen, lauf) {
  const empfaenger = await startEmpfaenger();
  const telemetrie = await starteTelemetrie({ url: empfaenger.url, token: TOKEN, ...optionen });
  try {
    return await lauf({ telemetrie, empfaenger });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
  }
}

function messe(telemetrie, { method = "GET", status = 200, route = "/messung", verzoegert = false, zusatz = {} }) {
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  let weitergegeben = 0;
  anfrageMessung(telemetrie)({ method, route: { path: route }, ...zusatz }, res, () => (weitergegeben += 1));
  const schliesse = () => res.emit("close");
  return {
    res,
    weitergegeben: () => weitergegeben,
    danach: verzoegert ? echtWarten(VERZOEGERUNG_MS).then(schliesse) : schliesse(),
  };
}

const attributeDerRoute = (export_, route, schluessel) =>
  new Set(punkteVon(export_).filter((p) => attribute(p).route === route).map((p) => attribute(p)[schluessel]));

async function konfigurationMit(umgebung, ladeFrisch) {
  const namen = Object.keys(umgebung);
  const gesichert = Object.fromEntries(namen.map((name) => [name, process.env[name]]));
  const setze = (werte) => {
    for (const [name, wert] of Object.entries(werte)) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
  };
  try {
    setze(umgebung);
    return await ladeFrisch();
  } finally {
    setze(gesichert);
  }
}

test("Messwerte direkt: Metrikname, Einheit, jede erlaubte Methode und die Statusklassen stehen im Export", async () => {
  await mitDirekterMessung({}, async ({ telemetrie, empfaenger }) => {
    for (const method of [...ERLAUBTE_METHODEN, NICHT_ERLAUBTE_METHODE]) messe(telemetrie, { method, route: "/methoden" });
    for (const [status] of STATUS_UND_KLASSE) messe(telemetrie, { status, route: "/status" });
    await telemetrie.spuele();
    const export_ = JSON.parse(empfaenger.empfangen[0].text);
    const [metrik] = export_.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
    assert.equal(metrik.name, "hermes.http.server.duration");
    assert.equal(metrik.unit, "ms");
    assert.deepEqual([...attributeDerRoute(export_, "/methoden", "method")].sort(), [...ERLAUBTE_METHODEN, "andere"].sort());
    assert.deepEqual(
      [...attributeDerRoute(export_, "/status", "status_class")].sort(),
      [...new Set(STATUS_UND_KLASSE.map(([, klasse]) => klasse))].sort(),
    );
  });
});

test("Messwerte direkt: ohne Messung ruft anfrageMessung next, haengt nichts an die Antwort und spuele liefert ein Versprechen", async () => {
  assert.equal(KEINE_TELEMETRIE.aktiv, false);
  assert.ok(KEINE_TELEMETRIE.spuele() instanceof Promise);
  assert.ok(KEINE_TELEMETRIE.stoppe() instanceof Promise);
  const res = new EventEmitter();
  let weitergegeben = 0;
  anfrageMessung(KEINE_TELEMETRIE)({}, res, () => (weitergegeben += 1));
  assert.equal(weitergegeben, 1);
  assert.equal(res.listenerCount("close"), 0, "keine Messung an der Antwort");
});

test("Messwerte direkt: eine Antwort, die nach etwa 30 ms schliesst, wird in Millisekunden gemessen", async () => {
  await mitDirekterMessung({}, async ({ telemetrie, empfaenger }) => {
    await messe(telemetrie, { verzoegert: true }).danach;
    await telemetrie.spuele();
    const [punkt] = punkteVon(JSON.parse(empfaenger.empfangen[0].text));
    assert.ok(punkt.sum >= MINDEST_DAUER_MS && punkt.sum < HOECHST_DAUER_MS, `Dauer ${punkt.sum} ms`);
  });
});

test("Messwerte direkt: Standardwerte ohne Benutzer und Version, Adresse mit Schraegstrichen endet auf genau einen Pfad", async () => {
  const empfaenger = await startEmpfaenger();
  const telemetrie = await starteTelemetrie({ url: `${empfaenger.url}${ADRESSE_MIT_SCHRAEGSTRICHEN}`, token: TOKEN });
  try {
    messe(telemetrie, {});
    await telemetrie.spuele();
    const [anfrage] = empfaenger.empfangen;
    assert.equal(anfrage.url, "/otlp/v1/metrics");
    assert.equal(anfrage.anmeldung, ANMELDUNG_OHNE_BENUTZER);
    const [{ resource }] = JSON.parse(anfrage.text).resourceMetrics;
    const version = resource.attributes.find((a) => a.key === "service.version");
    assert.equal(version.value.stringValue, "");
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
  }
});

test("Messwerte direkt: mit https-Adresse aber ohne Token bleibt es bei KEINE_TELEMETRIE", async () => {
  assert.equal(await starteTelemetrie({ url: "https://127.0.0.1:1/otlp" }), KEINE_TELEMETRIE);
  assert.equal(await starteTelemetrie({ url: "ftp://127.0.0.1:1/otlp", token: TOKEN }), KEINE_TELEMETRIE);
});

test("Messwerte direkt: spuele exportiert sofort, nach stoppe kommt kein weiterer Export", async () => {
  await mitDirekterMessung({ intervallMs: STANDARD_INTERVALL_MS }, async ({ telemetrie, empfaenger }) => {
    messe(telemetrie, {});
    await telemetrie.spuele();
    assert.equal(empfaenger.empfangen.length, 1, "spuele wartet auf den Export");
    messe(telemetrie, {});
    await telemetrie.stoppe();
    const nachStoppe = empfaenger.empfangen.length;
    await telemetrie.spuele();
    assert.equal(empfaenger.empfangen.length, nachStoppe, "nach stoppe kein Export mehr");
  });
});

test("Messwerte direkt: eine Telefonnummer in Anfragekoerper und Kopfzeile steht nach dem Export der POST-Route nicht im Export", async () => {
  await mitDirekterMessung({ intervallMs: Number(EXPORT_INTERVALL_MS) }, async ({ telemetrie, empfaenger }) => {
    const zusatz = { body: { to: `+${TELEFONNUMMER}` }, headers: { referer: `https://beispiel.invalid/+${TELEFONNUMMER}` } };
    messe(telemetrie, { method: "POST", route: "/api/plans", zusatz });
    await warteAufExport(empfaenger, (e) => attributeDerRoute(e, "/api/plans", "method").has("POST"));
    for (const eintrag of empfaenger.empfangen) assert.ok(!eintrag.text.includes(TELEFONNUMMER), "keine Nummer im Export");
  });
});

test("Messwerte direkt: die Konfiguration liefert getrimmte Telemetrie-Werte und den Rechnernamen ohne Instanzkennung", async () => {
  const mitWerten = await konfigurationMit(
    {
      METRIKEN_OTLP_URL: "  https://beispiel.invalid/otlp  ",
      METRIKEN_OTLP_BENUTZER: "  nutzer  ",
      RENDER_INSTANCE_ID: "  instanz-x  ",
      METRIKEN_INTERVALL_MS: String(KONFIG_INTERVALL_MS),
    },
    () => import("../../src/config.js?telemetrie-mit-werten"),
  );
  assert.equal(mitWerten.config.telemetry.telemetryOtlpUrl, "https://beispiel.invalid/otlp");
  assert.equal(mitWerten.config.telemetry.telemetryOtlpUser, "nutzer");
  assert.equal(mitWerten.config.telemetry.telemetryInstanceId, "instanz-x");
  assert.equal(mitWerten.config.telemetry.telemetryIntervalMs, KONFIG_INTERVALL_MS);
  const ohneWerte = await konfigurationMit(
    {
      METRIKEN_OTLP_URL: undefined,
      METRIKEN_OTLP_BENUTZER: undefined,
      RENDER_INSTANCE_ID: undefined,
      METRIKEN_INTERVALL_MS: undefined,
    },
    () => import("../../src/config.js?telemetrie-ohne-werte"),
  );
  assert.equal(ohneWerte.config.telemetry.telemetryOtlpUrl, "");
  assert.equal(ohneWerte.config.telemetry.telemetryOtlpUser, "");
  assert.equal(ohneWerte.config.telemetry.telemetryInstanceId, os.hostname());
  assert.equal(ohneWerte.config.telemetry.telemetryIntervalMs, STANDARD_INTERVALL_MS);
});

test("Messwerte direkt: ein Intervall unter dem Minimum oder keine Zahl faellt auf 60000 zurueck und steht in den Konfigurationsfehlern", async () => {
  const faelle = [
    [String(UNTER_MINIMUM_INTERVALL_MS), `Minimum ${MINIMUM_INTERVALL_MS}`, () => import("../../src/config.js?telemetrie-unter-minimum")],
    ["abc", '"abc"', () => import("../../src/config.js?telemetrie-keine-zahl")],
  ];
  for (const [wert, erwartet, ladeFrisch] of faelle) {
    const frisch = await konfigurationMit({ METRIKEN_INTERVALL_MS: wert }, ladeFrisch);
    assert.equal(frisch.config.telemetry.telemetryIntervalMs, STANDARD_INTERVALL_MS);
    const eintraege = frisch.configFatalErrors().filter((text) => text.includes("METRIKEN_INTERVALL_MS"));
    assert.equal(eintraege.length, 1);
    assert.ok(eintraege[0].includes(erwartet), eintraege[0]);
  }
});
