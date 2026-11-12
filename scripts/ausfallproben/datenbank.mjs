import { randomBytes } from "node:crypto";
import pg from "pg";
import { LOOPBACK } from "./ziel.mjs";

const NAMENSBYTES = 6;
const POSTGRES_PORT = "5432";
const LOKALE_HOSTS = [LOOPBACK, "localhost"];

export function lokaleDatenbank(adresse) {
  try {
    const url = new URL(adresse);
    return LOKALE_HOSTS.includes(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export async function legeDatenbankAn(url) {
  const verwaltung = new pg.Client({ connectionString: url.href });
  await verwaltung.connect();
  const name = `ausfallprobe_${randomBytes(NAMENSBYTES).toString("hex")}`;
  try {
    await verwaltung.query(`CREATE DATABASE ${name}`);
  } catch (fehler) {
    await verwaltung.end();
    throw fehler;
  }
  const eigene = new URL(url.href);
  eigene.pathname = `/${name}`;
  return {
    host: url.hostname,
    port: Number(url.port || POSTGRES_PORT),
    adresseUeber(weichePort) {
      const ueber = new URL(eigene.href);
      ueber.hostname = LOOPBACK;
      ueber.port = String(weichePort);
      return ueber.href;
    },
    async loesche() {
      try {
        await verwaltung.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await verwaltung.end();
      }
    },
  };
}
