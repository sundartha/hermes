import http from "node:http";
import { LOOPBACK } from "./ziel.mjs";

const HTTP_NICHT_ERREICHBAR = 503;
const API_SCHLUESSEL_KOPF = "xi-api-key";

function lausche(server) {
  return new Promise((resolve) => server.listen(0, LOOPBACK, () => resolve(server.address().port)));
}

function schliesse(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

export async function starteAnbieterWeiche() {
  const gesehen = [];
  const server = http.createServer((req, res) => {
    gesehen.push({
      methode: req.method,
      pfad: req.url,
      schluessel: req.headers[API_SCHLUESSEL_KOPF] ?? null,
    });
    res.writeHead(HTTP_NICHT_ERREICHBAR, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "ausfallprobe: Anbieter aus" }));
  });
  const port = await lausche(server);
  return { url: `http://${LOOPBACK}:${port}`, gesehen, beende: () => schliesse(server) };
}

export async function starteMessweiche({ zielPort, verzugMs }) {
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      const weiter = http.request(
        { host: LOOPBACK, port: zielPort, path: req.url, method: req.method },
        (antwort) => {
          res.writeHead(antwort.statusCode, antwort.headers);
          antwort.pipe(res);
        },
      );
      weiter.on("error", () => res.destroy());
      weiter.end();
    }, verzugMs);
  });
  const port = await lausche(server);
  return { url: `http://${LOOPBACK}:${port}`, beende: () => schliesse(server) };
}
