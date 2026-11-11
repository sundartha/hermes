import { once } from "node:events";
import net from "node:net";

const RELAIS_HOST = "127.0.0.1";
const BELIEBIGER_PORT = 0;
const EINFUEGEN = "INSERT INTO webhook_zustellung";
const ANFRAGE_KOPF_BYTES = 5;
const EINFACHE_ANFRAGE = 0x51;

const istAnfrage = (stueck, name) =>
  stueck[0] === EINFACHE_ANFRAGE && stueck.toString("latin1", ANFRAGE_KOPF_BYTES).startsWith(name);

export async function starteCommitRelais(datenbankAdresse) {
  const ziel = new URL(datenbankAdresse);
  const verbindungen = new Set();
  const zustand = { scharf: false, bestaetigung: Promise.withResolvers() };

  function oeffneVerbindung(kunde) {
    const verbindung = {
      kunde,
      ziel: net.connect({ host: ziel.hostname, port: Number(ziel.port) }),
    };
    verbindungen.add(verbindung);
    const haelt = (stueck) => {
      if (!zustand.scharf) return false;
      if (stueck.includes(EINFUEGEN)) verbindung.eingefuegt = true;
      return (
        verbindung.eingefuegt &&
        (istAnfrage(stueck, "COMMIT") || (zustand.auchRollback && istAnfrage(stueck, "ROLLBACK")))
      );
    };
    kunde.on("data", (stueck) => {
      if (verbindung.gehalten) return void verbindung.gehalten.push(stueck);
      if (haelt(stueck)) {
        verbindung.gehalten = [stueck];
        return undefined;
      }
      if (istAnfrage(stueck, "ROLLBACK")) verbindung.eingefuegt = false;
      return void verbindung.ziel.write(stueck);
    });
    verbindung.ziel.on("data", (stueck) =>
      kunde.write(stueck, () => {
        if (verbindung.freigegeben) zustand.bestaetigung.resolve();
      }),
    );
    const schliessen = () => {
      kunde.destroy();
      verbindung.ziel.destroy();
      verbindungen.delete(verbindung);
    };
    kunde.on("error", schliessen).on("close", schliessen);
    verbindung.ziel.on("error", schliessen).on("close", schliessen);
  }

  const server = net.createServer(oeffneVerbindung);
  server.listen(BELIEBIGER_PORT, RELAIS_HOST);
  await once(server, "listening");
  const adresse = new URL(datenbankAdresse);
  adresse.hostname = RELAIS_HOST;
  adresse.port = String(server.address().port);

  return {
    adresse: adresse.href,
    halteCommitNachInsert({ auchRollback = false } = {}) {
      zustand.scharf = true;
      zustand.auchRollback = auchRollback;
    },
    fortsetzen() {
      zustand.scharf = false;
      for (const verbindung of verbindungen) {
        if (!verbindung.gehalten) continue;
        verbindung.freigegeben = true;
        for (const stueck of verbindung.gehalten.splice(0)) verbindung.ziel.write(stueck);
        verbindung.gehalten = null;
      }
    },
    antwortUebergeben: () => zustand.bestaetigung.promise,
    async schliessen() {
      for (const { kunde, ziel: zielSocket } of verbindungen) {
        kunde.destroy();
        zielSocket.destroy();
      }
      server.close();
      await once(server, "close");
    },
  };
}
