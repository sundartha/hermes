import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { echtWarten } from "../echt-warten.js";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";

const TELEFONNUMMER = "4915112345678";
const TOKEN = "t".repeat(20);
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
  export_.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics.flatMap((m) => m.histogram.dataPoints)));
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

function exportOderFensterende(empfaenger, pruefung) {
  const erwarteterExport = warteAufExport(empfaenger, pruefung).catch(() => null);
  return Promise.race([erwarteterExport, echtWarten(KEINE_AUSFUHR_PRUEFFENSTER_MS)]);
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
    await exportOderFensterende(empfaenger, hatRoute("/api/calls/:id"));
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
