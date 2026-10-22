import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

export const POSTGRES_VARIABLE = "HERMES_TEST_POSTGRES_URL";
const OHNE_POSTGRES = `kein Postgres, übersprungen (${POSTGRES_VARIABLE} fehlt)`;
const NAMENSBYTES = 6;
const SQUAWK = readFileSync(new URL("../../tools/basis/squawk.toml", import.meta.url), "utf8");
const HAUPTVERSION = /^pg_version = "(\d+)\./m;

export function hauptversionLautSquawk() {
  return Number(HAUPTVERSION.exec(SQUAWK)[1]);
}

async function verbunden(adresse) {
  const verbindung = new pg.Client({ connectionString: adresse });
  await verbindung.connect();
  return verbindung;
}

function adresseFuer(adresse, datenbank) {
  const url = new URL(adresse);
  url.pathname = `/${datenbank}`;
  return url.href;
}

async function aufraeumen(verwaltung, offene, datenbank) {
  await Promise.allSettled(offene.map((verbindung) => verbindung.end()));
  try {
    await verwaltung.query(`DROP DATABASE IF EXISTS ${datenbank} WITH (FORCE)`);
  } finally {
    await verwaltung.end();
  }
}

export async function echteDatenbank(t) {
  const adresse = process.env[POSTGRES_VARIABLE];
  if (!adresse) {
    t.diagnostic(OHNE_POSTGRES);
    t.skip(OHNE_POSTGRES);
    return null;
  }
  const verwaltung = await verbunden(adresse);
  const datenbank = `hermes_test_${randomBytes(NAMENSBYTES).toString("hex")}`;
  try {
    await verwaltung.query(`CREATE DATABASE ${datenbank}`);
  } catch (fehler) {
    await verwaltung.end();
    throw fehler;
  }
  const offene = [];
  t.after(() => aufraeumen(verwaltung, offene, datenbank));
  const eigene = adresseFuer(adresse, datenbank);
  return {
    adresse: eigene,
    async verbinden() {
      const verbindung = await verbunden(eigene);
      offene.push(verbindung);
      return verbindung;
    },
  };
}
