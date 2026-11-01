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
