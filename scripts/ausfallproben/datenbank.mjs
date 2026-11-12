import { randomBytes } from "node:crypto";
import pg from "pg";
import { LOOPBACK } from "./ziel.mjs";

const NAMENSBYTES = 6;
const KENNWORTBYTES = 16;
const POSTGRES_PORT = "5432";
const LOKALE_HOSTS = [LOOPBACK, "localhost"];

export function lokaleDatenbank(adresse) {
  try {
    const url = new URL(adresse);
    return LOKALE_HOSTS.includes(url.hostname) && url.search === "" ? url : null;
  } catch {
    return null;
  }
}

async function raeumeAuf(verwaltung, name) {
  try {
    await verwaltung.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await verwaltung.query(`DROP ROLE IF EXISTS ${name}`);
  } catch {
  } finally {
    await verwaltung.end();
  }
}

export async function legeDatenbankAn(url, { mitRolle = false } = {}) {
  const verwaltung = new pg.Client({
    host: url.hostname,
    port: Number(url.port || POSTGRES_PORT),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
  });
  await verwaltung.connect();
  const name = `ausfallprobe_${randomBytes(NAMENSBYTES).toString("hex")}`;
  const eigene = new URL(url.href);
  eigene.pathname = `/${name}`;
  try {
    await verwaltung.query(`CREATE DATABASE ${name}`);
    if (mitRolle) {
      const kennwort = randomBytes(KENNWORTBYTES).toString("hex");
      await verwaltung.query(
        `CREATE ROLE ${name} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${kennwort}'`,
      );
      await verwaltung.query(`ALTER DATABASE ${name} OWNER TO ${name}`);
      eigene.username = name;
      eigene.password = kennwort;
    }
  } catch (fehler) {
    await raeumeAuf(verwaltung, name);
    throw fehler;
  }
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
        if (mitRolle) await verwaltung.query(`DROP ROLE IF EXISTS ${name}`);
      } finally {
        await verwaltung.end();
      }
    },
  };
}
