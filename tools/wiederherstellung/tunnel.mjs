import { connect as tcpVerbinden, createServer, isIP } from "node:net";
import { connect as tlsVerbinden } from "node:tls";

import pg from "pg";

import { fehlercode } from "./ausgabe.mjs";

const SSL_ANFRAGE_LAENGE = 8;
const SSL_ANFRAGE_CODE = 80877103;
const FELD_BREITE = 4;
const SSL_JA = 0x53;
const AUFBAU_FRIST_MS = 15000;
const LOKAL = "127.0.0.1";
const VERBINDUNG_FRIST_MS = 15000;
const PORT_STANDARD = 5432;
const POSTGRES_PROTOKOLLE = new Set(["postgres:", "postgresql:"]);
const ALPN = ["postgresql"];
const WIEDERHOLBAR = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "TUNNEL_ZEIT",
  "TUNNEL_GESCHLOSSEN",
  "VERBINDUNG",
]);

export class TunnelFehler extends Error {
  constructor(code) {
    super("Tunnel");
    this.name = "TunnelFehler";
    this.code = code;
  }
}

function sslAnfrage() {
  const puffer = Buffer.alloc(SSL_ANFRAGE_LAENGE);
  puffer.writeInt32BE(SSL_ANFRAGE_LAENGE, 0);
  puffer.writeInt32BE(SSL_ANFRAGE_CODE, FELD_BREITE);
  return puffer;
}

function tlsOptionen(ziel, roh) {
  const optionen = { socket: roh, host: ziel.host, ALPNProtocols: ALPN, rejectUnauthorized: true };
  return isIP(ziel.host) === 0 ? { ...optionen, servername: ziel.host } : optionen;
}

function tlsStarten(ziel, roh, { annehmen, scheitern }) {
  const sicher = tlsVerbinden(tlsOptionen(ziel, roh));
  sicher.once("error", scheitern);
  sicher.once("secureConnect", () => {
    sicher.removeListener("error", scheitern);
    annehmen(sicher);
  });
}

function sslAntwort(ziel, roh, ausgang) {
  return (antwort) => {
    roh.removeListener("end", ausgang.geschlossen);
    if (antwort.length !== 1 || antwort[0] !== SSL_JA) {
      ausgang.scheitern(new TunnelFehler("TLS_ABGELEHNT"));
      return;
    }
    tlsStarten(ziel, roh, ausgang);
  };
}

export function tlsAufbauen(ziel) {
  return new Promise((annehmen, ablehnen) => {
    const roh = tcpVerbinden({ host: ziel.host, port: ziel.port });
    const scheitern = (fehler) => {
      roh.destroy();
      ablehnen(fehler);
    };
    const zeitUm = () => scheitern(new TunnelFehler("TUNNEL_ZEIT"));
    const ausgang = {
      scheitern,
      geschlossen: () => scheitern(new TunnelFehler("TUNNEL_GESCHLOSSEN")),
      annehmen: (sicher) => {
        roh.setTimeout(0);
        roh.removeListener("timeout", zeitUm);
        annehmen(sicher);
      },
    };
    roh.setTimeout(AUFBAU_FRIST_MS, zeitUm);
    roh.on("error", scheitern);
    roh.once("end", ausgang.geschlossen);
    roh.once("connect", () => roh.write(sslAnfrage()));
    roh.once("data", sslAntwort(ziel, roh, ausgang));
  });
}

function verbinden(client, sicher, offene) {
  offene.add(sicher);
  sicher.on("error", () => client.destroy());
  sicher.on("close", () => {
    offene.delete(sicher);
    client.destroy();
  });
  client.on("close", () => sicher.destroy());
  client.pipe(sicher);
  sicher.pipe(client);
  client.resume();
}

export async function tunnelOeffnen(ziel) {
  const offene = new Set();
  const server = createServer({ pauseOnConnect: true }, (client) => {
    offene.add(client);
    client.on("error", () => {});
    client.on("close", () => offene.delete(client));
    tlsAufbauen(ziel).then(
      (sicher) => verbinden(client, sicher, offene),
      () => client.destroy(),
    );
  });
  await new Promise((fertig) => server.listen(0, LOKAL, fertig));
  return {
    port: server.address().port,
    pruefen: async () => (await tlsAufbauen(ziel)).destroy(),
    schliessen: () =>
      new Promise((fertig) => {
        for (const verbindung of offene) verbindung.destroy();
        server.close(() => fertig());
      }),
  };
}

export function verbindungZerlegen(roh) {
  if (typeof roh !== "string" || !URL.canParse(roh)) return null;
  const url = new URL(roh);
  if (!POSTGRES_PROTOKOLLE.has(url.protocol) || url.hostname === "") return null;
  try {
    return {
      benutzer: decodeURIComponent(url.username),
      passwort: decodeURIComponent(url.password),
      passwortRoh: url.password,
      datenbank: decodeURIComponent(url.pathname.slice(1)),
      server: { host: url.hostname, port: Number(url.port || PORT_STANDARD) },
    };
  } catch {
    return null;
  }
}

export function tunnelUrl(lokal) {
  const zugangsdaten =
    encodeURIComponent(lokal.benutzer) + ":" + encodeURIComponent(lokal.passwort);
  const ziel = LOKAL + ":" + lokal.port + "/" + encodeURIComponent(lokal.datenbank);
  return "postgres://" + zugangsdaten + "@" + ziel + "?sslmode=disable";
}

export async function mitClient(lokal, arbeit) {
  const client = new pg.Client({
    host: LOKAL,
    port: lokal.port,
    user: lokal.benutzer,
    password: lokal.passwort,
    database: lokal.datenbank,
    ssl: false,
    connectionTimeoutMillis: VERBINDUNG_FRIST_MS,
  });
  client.on("error", () => {});
  await client.connect();
  try {
    return await arbeit(client);
  } finally {
    await client.end().catch(() => {});
  }
}

function codeVon(fehler, ersatz) {
  return fehlercode(fehler)?.text ?? ersatz;
}

export async function verbindungVersuchen(tunnel, lokal) {
  try {
    await tunnel.pruefen();
  } catch (fehler) {
    const code = codeVon(fehler, "TUNNEL_UNBEKANNT");
    return { wo: "tunnel", code, wiederholen: WIEDERHOLBAR.has(code) };
  }
  try {
    await mitClient(lokal, (client) => client.query("SELECT 1"));
    return null;
  } catch (fehler) {
    return { wo: "verbindung", code: codeVon(fehler, "VERBINDUNG"), wiederholen: true };
  }
}
