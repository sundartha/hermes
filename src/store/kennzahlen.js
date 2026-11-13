import pg from "pg";
import { config } from "../config.js";
import { merkeLogPasswort } from "../log-maske.js";
import { START_ROUTINE, START_SPERRE_NAMENSRAUM } from "../begriffe/speicher.js";
import { KENNZAHLEN_LESER_ROLLE } from "../db/migrate.js";
import { makeKeyedSingleFlight } from "../single-flight.ts";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";

const TAKT_MS = MS_PER_MINUTE;
const FRIST_SEKUNDEN = 5;
const FRIST_MS = FRIST_SEKUNDEN * MS_PER_SECOND;
const FRIST_CODE = "KENNZAHLEN_FRIST";
const ROLLE_CODE = "KENNZAHLEN_ROLLE";
const VERBINDUNGSGRENZE = 2;
const ROLLE_ABFRAGE = `SELECT (
  r.rolconnlimit = ${VERBINDUNGSGRENZE} AND NOT r.rolsuper AND NOT r.rolbypassrls
  AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
      AND has_any_column_privilege(c.oid, 'SELECT'))
  AND NOT has_schema_privilege('public', 'CREATE')
  AND NOT has_database_privilege(current_database(), 'CREATE')
) AS erlaubt FROM pg_roles r WHERE r.rolname = current_user`;
const SPERRE_ABFRAGE = "SELECT pg_try_advisory_lock($1, $2) AS erhalten";
const SPERRE_SCHLUESSEL = [START_SPERRE_NAMENSRAUM, START_ROUTINE.KENNZAHLEN];
const SICHT_ABFRAGE = "SELECT messwert, richtung, ergebnis, ziel, plan, wert FROM kennzahlen.messwerte";

let verbindung = null;
let momentaufnahme = null;
let haeltSperre = false;
let zeitgeber = null;

function verwerfen() {
  const alt = verbindung;
  verbindung = null;
  momentaufnahme = null;
  haeltSperre = false;
  if (alt) alt.end().catch(() => {});
}

function meldeFehler(fehler) {
  console.error(`[kennzahlen] Lauf fehlgeschlagen: ${fehler?.code ?? fehler?.name ?? "unbekannt"}`);
}

function mitFrist(arbeit) {
  let uhr;
  const abgelaufen = new Promise((_erfuellen, ablehnen) => {
    uhr = setTimeout(() => ablehnen(Object.assign(new Error(FRIST_CODE), { code: FRIST_CODE })), FRIST_MS);
  });
  return Promise.race([arbeit, abgelaufen]).finally(() => clearTimeout(uhr));
}

async function verbindungOeffnen() {
  merkeLogPasswort(config.store.kennzahlenDatabaseUrl);
  const client = new pg.Client({
    connectionString: config.store.kennzahlenDatabaseUrl,
    statement_timeout: FRIST_MS,
    connectionTimeoutMillis: FRIST_MS,
  });
  verbindung = client;
  client.on("error", () => {
    if (verbindung === client) verwerfen();
  });
  await client.connect();
  return client;
}

async function rolleErzwingen(client) {
  const { rows } = await client.query(ROLLE_ABFRAGE);
  if (rows[0]?.erlaubt !== true) throw Object.assign(new Error(ROLLE_CODE), { code: ROLLE_CODE });
}

async function sichtLesen() {
  const client = verbindung ?? (await verbindungOeffnen());
  await rolleErzwingen(client);
  if (!haeltSperre) {
    const { rows } = await client.query(SPERRE_ABFRAGE, SPERRE_SCHLUESSEL);
    haeltSperre = rows[0].erhalten;
  }
  return haeltSperre ? client.query(SICHT_ABFRAGE) : { rows: null };
}

function messwertZeile({ messwert, richtung, ergebnis, ziel, plan, wert }) {
  return { messwert, richtung, ergebnis, ziel, plan, wert: Number(wert) };
}

async function taktAusfuehren() {
  try {
    const { rows } = await mitFrist(sichtLesen());
    momentaufnahme = rows?.map(messwertZeile) ?? null;
  } catch (fehler) {
    verwerfen();
    meldeFehler(fehler);
  }
  return momentaufnahme;
}

export const kennzahlenTakt = makeKeyedSingleFlight(taktAusfuehren);

export function kennzahlenMomentaufnahme() {
  return momentaufnahme;
}

async function durchlauf(rolleVorhanden) {
  const rolleDa = await mitFrist(rolleVorhanden(KENNZAHLEN_LESER_ROLLE)).catch((fehler) => {
    meldeFehler(fehler);
    return false;
  });
  if (rolleDa) await kennzahlenTakt();
  else verwerfen();
}

export function starteLauf(rolleVorhanden) {
  if (!zeitgeber) {
    zeitgeber = setInterval(() => void durchlauf(rolleVorhanden), TAKT_MS);
    zeitgeber.unref();
  }
  return durchlauf(rolleVorhanden);
}
