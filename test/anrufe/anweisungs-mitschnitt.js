import { once } from "node:events";
import net from "node:net";

const RELAIS_HOST = "127.0.0.1";
const BELIEBIGER_PORT = 0;
const KOPF_BYTES = 5;
const LAENGE_BYTES = 4;
const EINFACHE_ANFRAGE = 0x51;
const PARSE = 0x50;

function anweisung(art, inhalt) {
  if (art === EINFACHE_ANFRAGE) return inhalt.toString("utf8", 0, inhalt.length - 1);
  if (art !== PARSE) return null;
  const nameEnde = inhalt.indexOf(0);
  return inhalt.toString("utf8", nameEnde + 1, inhalt.indexOf(0, nameEnde + 1));
}

function liesAnweisungen(zustand, stueck) {
  zustand.puffer = Buffer.concat([zustand.puffer, stueck]);
  if (!zustand.angemeldet) {
    if (zustand.puffer.length < LAENGE_BYTES || zustand.puffer.length < zustand.puffer.readInt32BE(0)) return;
    zustand.puffer = zustand.puffer.subarray(zustand.puffer.readInt32BE(0));
    zustand.angemeldet = true;
  }
  while (zustand.puffer.length >= KOPF_BYTES) {
    const laenge = zustand.puffer.readInt32BE(1);
    if (zustand.puffer.length < laenge + 1) return;
    const text = anweisung(zustand.puffer[0], zustand.puffer.subarray(KOPF_BYTES, laenge + 1));
    if (text !== null) zustand.anweisungen.push(text);
    zustand.puffer = zustand.puffer.subarray(laenge + 1);
  }
}

export async function starteAnweisungsMitschnitt(datenbankAdresse) {
  const ziel = new URL(datenbankAdresse);
  const verbindungen = [];
  const sockets = new Set();
  const server = net.createServer((kunde) => {
    const zustand = { puffer: Buffer.alloc(0), angemeldet: false, anweisungen: [] };
    verbindungen.push(zustand);
    const datenbank = net.connect({ host: ziel.hostname, port: Number(ziel.port) });
    sockets.add(kunde).add(datenbank);
    kunde.on("data", (stueck) => {
      liesAnweisungen(zustand, stueck);
      datenbank.write(stueck);
    });
    datenbank.on("data", (stueck) => kunde.write(stueck));
    for (const [a, b] of [[kunde, datenbank], [datenbank, kunde]]) a.on("error", () => b.destroy()).on("close", () => b.destroy());
  });
  server.listen(BELIEBIGER_PORT, RELAIS_HOST);
  await once(server, "listening");
  const adresse = new URL(datenbankAdresse);
  adresse.hostname = RELAIS_HOST;
  adresse.port = String(server.address().port);
  return {
    adresse: adresse.href,
    verbindungen: () => verbindungen.map((zustand) => [...zustand.anweisungen]),
    async schliessen() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}
