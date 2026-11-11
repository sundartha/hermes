import http from "node:http";

const WARTE_FRIST_MS = 8000;
const HTTP_OK = 200;

export function startEmpfaenger() {
  const exporte = [];
  const wartende = [];
  const empfaenger = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      exporte.push(JSON.parse(Buffer.concat(teile).toString("utf8")));
      for (const wartender of wartende.splice(0)) wartender();
      res.writeHead(HTTP_OK, { "content-type": "application/json" }).end("{}");
    });
  });
  return new Promise((resolve) => {
    empfaenger.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${empfaenger.address().port}/otlp`,
        exporte,
        wartende,
        stop: () => new Promise((fertig) => empfaenger.close(fertig)),
      });
    });
  });
}

const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);

export const messwerte = (export_) =>
  Object.fromEntries(
    metrikenVon(export_)
      .filter((m) => m.gauge)
      .map((m) => [m.name, { einheit: m.unit, punkte: m.gauge.dataPoints }]),
  );

export function warteAufExport(empfaenger, pruefung, ab = 0) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export")));
    const pruefen = () => {
      const neue = empfaenger.exporte.slice(ab);
      const treffer = neue.map(messwerte).findLast(pruefung);
      if (treffer) resolve(treffer);
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

export const wert = (punkte) => Number(punkte[0].asDouble ?? punkte[0].asInt);
