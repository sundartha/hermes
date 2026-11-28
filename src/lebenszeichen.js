import { createHistogram, performance } from "node:perf_hooks";
import pg from "pg";
import { config } from "./config.ts";
import { fehlerart, verzugUeberGrenze } from "./lebenszeichen-regeln.js";
import { anfrage } from "./utils/anfrage.ts";

const MESSTAKT_MS = 10;
const NS_JE_MS = 1e6;
const PG_SPEICHER = "pg";
const KUERZESTE_FRIST_MS = 1;
const DB_LOG_VORSILBE = "[lebenszeichen] Datenbankprüfung gescheitert:";
const LOG_VORSILBE = "[lebenszeichen] Meldung gescheitert:";

async function meldeHerzschlag(adresse, fristMs) {
  try {
    const antwort = await anfrage(adresse, { fristMs });
    await antwort.body?.cancel();
    if (!antwort.ok) console.warn(`${LOG_VORSILBE} HTTP ${antwort.status}`);
  } catch (fehler) {
    console.warn(`${LOG_VORSILBE} ${fehlerart(fehler)}`);
  }
}

async function pruefeDatenbank(adresse, fristMs) {
  const beginn = performance.now();
  const client = new pg.Client({ connectionString: adresse, connectionTimeoutMillis: fristMs });
  client.on("error", () => {});
  try {
    await client.connect();
    const restMs = Math.floor(fristMs - (performance.now() - beginn));
    await client.query({ text: "SELECT 1", query_timeout: Math.max(KUERZESTE_FRIST_MS, restMs) });
  } finally {
    client.end().catch(() => {});
  }
}

const ECHTE_ZEIT = {
  jetzt: () => performance.now(),
  planeTakt: (aufgabe, abstandMs) => setInterval(aufgabe, abstandMs).unref(),
};

export function starteLebenszeichen(
  { herzschlagUrl, herzschlagTaktMs, herzschlagVerzugGrenzeMs, herzschlagFristMs },
  speicher = config.store,
  zeit = ECHTE_ZEIT,
) {
  const adresse = herzschlagUrl.trim();
  if (!adresse) return;
  const histogramm = createHistogram();
  let letzteMessung = zeit.jetzt();
  zeit.planeTakt(() => {
    const jetzt = zeit.jetzt();
    histogramm.record(Math.max(1, Math.round((jetzt - letzteMessung - MESSTAKT_MS) * NS_JE_MS)));
    letzteMessung = jetzt;
  }, MESSTAKT_MS);
  const mitDatenbank = speicher.storeBackend === PG_SPEICHER;
  let letzterTakt = zeit.jetzt();
  let pruefungLaeuft = false;
  zeit.planeTakt(async () => {
    const jetzt = zeit.jetzt();
    const taktVerzugMs = jetzt - letzterTakt - herzschlagTaktMs;
    const histogrammMs = histogramm.max / NS_JE_MS;
    letzterTakt = jetzt;
    histogramm.reset();
    const verzug = {
      taktVerzugMs,
      hoechstVerzugMs: histogrammMs,
      grenzeMs: herzschlagVerzugGrenzeMs,
    };
    if (verzugUeberGrenze(verzug)) return;
    if (mitDatenbank) {
      if (pruefungLaeuft) return;
      pruefungLaeuft = true;
      try {
        await pruefeDatenbank(speicher.databaseUrl, herzschlagFristMs);
      } catch (fehler) {
        console.warn(`${DB_LOG_VORSILBE} ${fehlerart(fehler)}`);
        return;
      } finally {
        pruefungLaeuft = false;
      }
    }
    void meldeHerzschlag(adresse, herzschlagFristMs);
  }, herzschlagTaktMs);
}
