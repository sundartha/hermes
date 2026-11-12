import http from "node:http";
import net from "node:net";
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

export async function starteAnbieterWeiche({ verzugMs = 0 } = {}) {
  const gesehen = [];
  let verzug = verzugMs;
  const server = http.createServer((req, res) => {
    const aufruf = {
      methode: req.method,
      pfad: req.url,
      schluessel: req.headers[API_SCHLUESSEL_KOPF] ?? null,
      beantwortetNachMs: null,
    };
    const start = performance.now();
    gesehen.push(aufruf);
    setTimeout(() => {
      res.writeHead(HTTP_NICHT_ERREICHBAR, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "ausfallprobe: Anbieter gestoert" }), () => {
        aufruf.beantwortetNachMs = Math.round(performance.now() - start);
      });
    }, verzug);
  });
  const port = await lausche(server);
  return {
    url: `http://${LOOPBACK}:${port}`,
    gesehen,
    setzeVerzug: (ms) => void (verzug = ms),
    beende: () => schliesse(server),
  };
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

function verbinde(aussen, ziel, offene) {
  const innen = net.connect(ziel.zielPort, ziel.zielHost);
  const paar = { aussen, innen };
  offene.add(paar);
  const ende = () => {
    offene.delete(paar);
    aussen.destroy();
    innen.destroy();
  };
  for (const socket of [aussen, innen]) {
    socket.on("error", () => {});
    socket.on("close", ende);
  }
  aussen.pipe(innen);
  innen.pipe(aussen);
}

export async function starteDatenbankWeiche({ zielHost, zielPort }) {
  const zaehler = { angenommen: 0, gekappt: 0, abgewiesen: 0 };
  const offene = new Set();
  let abweisen = false;
  const server = net.createServer((aussen) => {
    if (abweisen) {
      zaehler.abgewiesen += 1;
      aussen.destroy();
      return;
    }
    zaehler.angenommen += 1;
    verbinde(aussen, { zielHost, zielPort }, offene);
  });
  const port = await lausche(server);
  return {
    port,
    zaehler,
    async stoere(abweisenMs) {
      abweisen = true;
      zaehler.gekappt += offene.size;
      for (const { aussen, innen } of [...offene]) {
        aussen.destroy();
        innen.destroy();
      }
      await new Promise((resolve) => setTimeout(resolve, abweisenMs));
      abweisen = false;
    },
    beende() {
      for (const { aussen, innen } of offene) {
        aussen.destroy();
        innen.destroy();
      }
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
