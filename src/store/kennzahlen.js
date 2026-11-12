import pg from "pg";
import { config } from "../config.js";
import { KENNZAHLEN_LESER_ROLLE } from "../db/migrate.js";
import { makeKeyedSingleFlight } from "../single-flight.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";

const TAKT_MS = MS_PER_MINUTE;
const FRIST_SEKUNDEN = 5;
const FRIST_MS = FRIST_SEKUNDEN * MS_PER_SECOND;
const FRIST_CODE = "KENNZAHLEN_FRIST";
const TAKT_SCHLUESSEL = "kennzahlen";
const SICHT_ABFRAGE = "SELECT messwert, richtung, ergebnis, ziel, plan, wert FROM kennzahlen.messwerte";

let verbindung = null;
let momentaufnahme = null;
let zeitgeber = null;

function verwerfen() {
  const alt = verbindung;
  verbindung = null;
  momentaufnahme = null;
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

async function sichtLesen() {
  const client = verbindung ?? (await verbindungOeffnen());
  return client.query(SICHT_ABFRAGE);
}

function messwertZeile({ messwert, richtung, ergebnis, ziel, plan, wert }) {
  return { messwert, richtung, ergebnis, ziel, plan, wert: Number(wert) };
}

async function taktAusfuehren() {
  try {
    const { rows } = await mitFrist(sichtLesen());
    momentaufnahme = rows.map(messwertZeile);
  } catch (fehler) {
    verwerfen();
    meldeFehler(fehler);
  }
  return momentaufnahme;
}

export const kennzahlenTakt = makeKeyedSingleFlight(taktAusfuehren, () => TAKT_SCHLUESSEL);

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
