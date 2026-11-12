import http from "node:http";

import { OTLP_MESSWERTE_TOKEN as TOKEN } from "./erfundene-geheimnisse.js";
const BENUTZER = "123456";
const HTTP_OK = 200;
const ZAEHLER = "hermes.anbieter.aufrufe";
const DAUER = "hermes.anbieter.dauer";
const EXPORT_INTERVALL_MS = 3_600_000;

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

const zaehlerPunkt = (p) => ({ ...attribute(p), wert: Number(p.asInt ?? p.asDouble) });
const dauerPunkt = (p) => ({ attribute: attribute(p), anzahl: Number(p.count) });
const summen = (m) => m.sum.dataPoints;
const histogramme = (m) => m.histogram.dataPoints;

export const zaehlerPunkte = (exporte) =>
  metrikenVon(exporte, ZAEHLER)
    .flatMap((m) => summen(m).map(zaehlerPunkt))
    .sort((a, b) => a.vorgang.localeCompare(b.vorgang));

export const dauerPunkte = (exporte) =>
  metrikenVon(exporte, DAUER).flatMap((m) => histogramme(m).map(dauerPunkt));

export async function mitTelemetrie(starteTelemetrie, lauf) {
  const empfaenger = await startEmpfaenger();
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    benutzer: BENUTZER,
    token: TOKEN,
    instanzKennung: "instanz-test",
    version: "test",
    intervallMs: EXPORT_INTERVALL_MS,
  });
  try {
    return await lauf({ telemetrie, exporte: empfaenger.empfangen });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
  }
}
