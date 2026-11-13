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

function neuerLeser() {
  const anweisungen = [];
  let puffer = Buffer.alloc(0);
  let angemeldet = false;
  const lies = (stueck) => {
    puffer = Buffer.concat([puffer, stueck]);
    if (!angemeldet) {
      if (puffer.length < LAENGE_BYTES || puffer.length < puffer.readInt32BE(0)) return;
      puffer = puffer.subarray(puffer.readInt32BE(0));
      angemeldet = true;
    }
    while (puffer.length >= KOPF_BYTES) {
      const laenge = puffer.readInt32BE(1);
      if (puffer.length < laenge + 1) return;
      const text = anweisung(puffer[0], puffer.subarray(KOPF_BYTES, laenge + 1));
      if (text !== null) anweisungen.push(text);
      puffer = puffer.subarray(laenge + 1);
    }
  };
  return { lies, anweisungen };
}

export async function starteAnweisungsMitschnitt(datenbankAdresse) {
  const ziel = new URL(datenbankAdresse);
  const verbindungen = [];
  const sockets = new Set();
  const server = net.createServer((kunde) => {
    const zustand = neuerLeser();
    verbindungen.push(zustand);
    const datenbank = net.connect({ host: ziel.hostname, port: Number(ziel.port) });
    sockets.add(kunde).add(datenbank);
    kunde.on("data", (stueck) => {
      zustand.lies(stueck);
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
