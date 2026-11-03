import { createServer, request } from "node:http";
import { once } from "node:events";

import { WEBHOOKS } from "./befehle.mjs";
import { HermesCtlFehler } from "./sitzung.mjs";

const ANGABE = /^([A-Za-z0-9-]+)=(\d+)$/;
const SCHLECHTES_GATEWAY = 502;
const LOKALE_ADRESSE = "127.0.0.1";
const ANY_PORT = 0;

const webhookNamen = () => [...WEBHOOKS.keys()].join(", ");

function angabeLesen(angabe) {
  const treffer = ANGABE.exec(angabe);
  if (treffer === null || !WEBHOOKS.has(treffer[1])) {
    throw new HermesCtlFehler(
      `Ungültige Verzögerung: ${angabe}`,
      `Nimm --verzoegern WEBHOOK=MS mit einem Webhook aus: ${webhookNamen()}.`,
    );
  }
  return { name: treffer[1], pfad: WEBHOOKS.get(treffer[1]).pfad, ms: Number(treffer[2]) };
}

export const verzoegerungenLesen = (angaben) => angaben.map(angabeLesen);

export const verzoegerungenAlsObjekt = (verzoegerungen) =>
  Object.fromEntries(verzoegerungen.map(({ name, ms }) => [name, ms]));

function weiterleiten(eingang, ausgang, ziel) {
  const weiter = request(
    {
      host: ziel.hostname,
      port: ziel.port,
      method: eingang.method,
      path: eingang.url,
      headers: { ...eingang.headers, host: ziel.host },
    },
    (antwort) => {
      ausgang.writeHead(antwort.statusCode, antwort.headers);
      antwort.pipe(ausgang);
    },
  );
  weiter.on("error", () => {
    if (ausgang.headersSent) {
      ausgang.destroy();
      return;
    }
    ausgang.writeHead(SCHLECHTES_GATEWAY).end();
  });
  ausgang.on("close", () => weiter.destroy());
  eingang.pipe(weiter);
}

export async function vorschaltStarten({ ziel, verzoegerungen }) {
  const zielAdresse = new URL(ziel);
  const wartezeiten = new Map(verzoegerungen.map(({ pfad, ms }) => [pfad, ms]));
  const server = createServer((eingang, ausgang) => {
    const pfad = new URL(eingang.url, zielAdresse).pathname;
    const warten = wartezeiten.get(pfad) ?? 0;
    const timer = setTimeout(() => weiterleiten(eingang, ausgang, zielAdresse), warten);
    ausgang.on("close", () => clearTimeout(timer));
  });
  server.listen(ANY_PORT, LOKALE_ADRESSE);
  await once(server, "listening");
  const { port } = server.address();
  return {
    port,
    url: `http://${LOKALE_ADRESSE}:${port}`,
    async schliessen() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
