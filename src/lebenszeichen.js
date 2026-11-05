import { createHistogram, performance } from "node:perf_hooks";
import pg from "pg";
import { config } from "./config.js";

const MESSTAKT_MS = 10;
const NS_JE_MS = 1e6;
const PG_SPEICHER = "pg";
const FRIST_CODE = "FRIST";
const DB_LOG_VORSILBE = "[lebenszeichen] Datenbankprüfung gescheitert:";
const LOG_VORSILBE = "[lebenszeichen] Meldung gescheitert:";
const UNBEKANNTE_FEHLERART = "unbekannt";

function fehlerart(fehler) {
  const code = fehler?.cause?.code ?? fehler?.code;
  return typeof code === "string" ? code : String(fehler?.name ?? UNBEKANNTE_FEHLERART);
}

async function meldeHerzschlag(adresse, fristMs) {
  try {
    const antwort = await fetch(adresse, { signal: AbortSignal.timeout(fristMs) });
    await antwort.body?.cancel();
    if (!antwort.ok) console.warn(`${LOG_VORSILBE} HTTP ${antwort.status}`);
  } catch (fehler) {
    console.warn(`${LOG_VORSILBE} ${fehlerart(fehler)}`);
  }
}

async function pruefeDatenbank(adresse, fristMs) {
  const client = new pg.Client({ connectionString: adresse });
  client.on("error", () => {});
  let fristTimer;
  const frist = new Promise((_erfuellt, ab) => {
    fristTimer = setTimeout(() => {
      client.connection.stream.destroy();
      ab(Object.assign(new Error("Frist abgelaufen"), { code: FRIST_CODE }));
    }, fristMs);
  });
  const abfrage = (async () => {
    await client.connect();
    await client.query("SELECT 1");
  })();
  abfrage.catch(() => {});
  try {
    await Promise.race([abfrage, frist]);
  } finally {
    clearTimeout(fristTimer);
    client.end().catch(() => {});
  }
}

export function starteLebenszeichen(
  { herzschlagUrl, herzschlagTaktMs, herzschlagVerzugGrenzeMs, herzschlagFristMs },
  speicher = config.store,
) {
  const adresse = herzschlagUrl.trim();
  if (!adresse) return;
  const histogramm = createHistogram();
  let letzteMessung = performance.now();
  setInterval(() => {
    const jetzt = performance.now();
    histogramm.record(Math.max(1, Math.round((jetzt - letzteMessung - MESSTAKT_MS) * NS_JE_MS)));
    letzteMessung = jetzt;
  }, MESSTAKT_MS).unref();
  const mitDatenbank = speicher.storeBackend === PG_SPEICHER;
  let letzterTakt = performance.now();
  let pruefungLaeuft = false;
  setInterval(async () => {
    const jetzt = performance.now();
    const taktVerzugMs = jetzt - letzterTakt - herzschlagTaktMs;
    const histogrammMs = histogramm.max / NS_JE_MS;
    letzterTakt = jetzt;
    histogramm.reset();
    if (taktVerzugMs > herzschlagVerzugGrenzeMs || histogrammMs > herzschlagVerzugGrenzeMs) return;
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
  }, herzschlagTaktMs).unref();
}
