import { randomBytes } from "node:crypto";
import pg from "pg";

import { echteDatenbank, POSTGRES_VARIABLE } from "./echtes-postgres.js";

const NAMENSBYTES = 6;
const KENNWORTBYTES = 16;

function adresseMitRolle(adresse, rolle, kennwort) {
  const url = new URL(adresse);
  url.username = rolle;
  url.password = kennwort;
  return url.href;
}

async function alsVerwaltung(arbeit) {
  const verwaltung = new pg.Client({ connectionString: process.env[POSTGRES_VARIABLE] });
  await verwaltung.connect();
  try {
    return await arbeit(verwaltung);
  } finally {
    await verwaltung.end();
  }
}

export async function echteDatenbankMitRolle(t) {
  const db = await echteDatenbank(t);
  if (!db) return null;
  const datenbank = new URL(db.adresse).pathname.slice(1);
  const rolle = `hermes_test_${randomBytes(NAMENSBYTES).toString("hex")}`;
  const kennwort = randomBytes(KENNWORTBYTES).toString("hex");
  t.after(() =>
    alsVerwaltung(async (verwaltung) => {
      await verwaltung.query(`DROP DATABASE IF EXISTS ${datenbank} WITH (FORCE)`);
      await verwaltung.query(`DROP ROLE IF EXISTS ${rolle}`);
    }),
  );
  await alsVerwaltung(async (verwaltung) => {
    await verwaltung.query(
      `CREATE ROLE ${rolle} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${kennwort}'`,
    );
    await verwaltung.query(`ALTER DATABASE ${datenbank} OWNER TO ${rolle}`);
  });
  return {
    adresse: adresseMitRolle(db.adresse, rolle, kennwort),
    rolle,
    leerlaufVerbindungenBeenden: () =>
      alsVerwaltung((verwaltung) =>
        verwaltung.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND usename = $2 AND state = 'idle'",
          [datenbank, rolle],
        ),
      ),
  };
}
