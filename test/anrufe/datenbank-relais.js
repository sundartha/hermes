import { once } from "node:events";
import net from "node:net";

const RELAIS_HOST = "127.0.0.1";
const BELIEBIGER_PORT = 0;

function uebergib(socket, stuecke) {
  return stuecke.splice(0).map((stueck) => new Promise((fertig) => socket.write(stueck, () => fertig())));
}

export async function starteDatenbankRelais(datenbankAdresse) {
  const ziel = new URL(datenbankAdresse);
  const verbindungen = new Set();
  const zustand = { angehalten: false, uebergaben: [] };

  function oeffneZiel(verbindung) {
    const socket = net.connect({ host: ziel.hostname, port: Number(ziel.port) });
    socket.on("data", (stueck) => weiter(verbindung, { nachKunde: true, stueck }));
    socket.on("error", () => verbindung.kunde.destroy());
    socket.on("close", () => verbindung.kunde.destroy());
    return socket;
  }

  function weiter(verbindung, { nachKunde, stueck }) {
    if (zustand.angehalten) return (nachKunde ? verbindung.zumKunden : verbindung.zumZiel).push(stueck);
    return (nachKunde ? verbindung.kunde : verbindung.ziel).write(stueck);
  }

  const server = net.createServer((kunde) => {
    const verbindung = { kunde, ziel: null, zumZiel: [], zumKunden: [] };
    verbindungen.add(verbindung);
    kunde.on("data", (stueck) => weiter(verbindung, { nachKunde: false, stueck }));
    kunde.on("error", () => verbindung.ziel?.destroy());
    kunde.on("close", () => {
      verbindung.ziel?.destroy();
      verbindungen.delete(verbindung);
    });
    if (!zustand.angehalten) verbindung.ziel = oeffneZiel(verbindung);
  });
  server.listen(BELIEBIGER_PORT, RELAIS_HOST);
  await once(server, "listening");
  const adresse = new URL(datenbankAdresse);
  adresse.hostname = RELAIS_HOST;
  adresse.port = String(server.address().port);

  const trennen = () => {
    for (const { kunde, ziel: zielSocket } of verbindungen) {
      kunde.destroy();
      zielSocket?.destroy();
    }
  };

  return {
    adresse: adresse.href,
    anhalten() {
      zustand.angehalten = true;
    },
    fortsetzen() {
      zustand.angehalten = false;
      for (const verbindung of verbindungen) {
        verbindung.ziel ??= oeffneZiel(verbindung);
        zustand.uebergaben.push(...uebergib(verbindung.ziel, verbindung.zumZiel));
        zustand.uebergaben.push(...uebergib(verbindung.kunde, verbindung.zumKunden));
      }
    },
    async abwarten() {
      const offen = zustand.uebergaben.splice(0);
      await Promise.all(offen);
    },
    trennen,
    async schliessen() {
      trennen();
      server.close();
      await once(server, "close");
    },
  };
}
