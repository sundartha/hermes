import { createHistogram, performance } from "node:perf_hooks";
import { config } from "./config.js";

const MESS_TAKT_MS = 10;
const NANOSEKUNDEN_JE_MS = 1e6;
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

async function pruefeDatenbank(datenbankUrl, fristMs) {
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: datenbankUrl });
  client.on("error", () => {});
  const frist = setTimeout(() => {
    const strom = client.connection.stream;
    if (!strom.destroyed) strom.resetAndDestroy();
  }, fristMs);
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    clearTimeout(frist);
    client.connection.stream.destroy();
  }
}

function starteMessung() {
  const verzuege = createHistogram();
  let letzterMessMs = performance.now();
  const messe = () => {
    const jetztMs = performance.now();
    const verzugMs = jetztMs - letzterMessMs - MESS_TAKT_MS;
    letzterMessMs = jetztMs;
    if (verzugMs > 0) verzuege.record(Math.max(1, Math.round(verzugMs * NANOSEKUNDEN_JE_MS)));
  };
  setInterval(messe, MESS_TAKT_MS).unref();
  return () => {
    messe();
    const hoechstMs = verzuege.max / NANOSEKUNDEN_JE_MS;
    verzuege.reset();
    return hoechstMs;
  };
}

export function starteLebenszeichen({
  herzschlagUrl,
  herzschlagTaktMs,
  herzschlagVerzugGrenzeMs,
  herzschlagFristMs,
}) {
  const adresse = herzschlagUrl.trim();
  if (!adresse) return;
  const mitDatenbank = config.store.storeBackend === "pg";
  const entnimmHoechstMs = starteMessung();
  let letzterTaktMs = performance.now();
  let datenbankPruefungLaeuft = false;
  const takt = async () => {
    const jetztMs = performance.now();
    const taktVerzugMs = jetztMs - letzterTaktMs - herzschlagTaktMs;
    letzterTaktMs = jetztMs;
    const verzugMs = Math.max(taktVerzugMs, entnimmHoechstMs());
    if (verzugMs > herzschlagVerzugGrenzeMs) {
      console.warn(`[lebenszeichen] nicht gemeldet: Event-Loop-Verzug ${verzugMs} ms`);
      return;
    }
    if (mitDatenbank) {
      if (datenbankPruefungLaeuft) {
        console.warn("[lebenszeichen] nicht gemeldet: Datenbank-Prüfung läuft noch");
        return;
      }
      datenbankPruefungLaeuft = true;
      try {
        await pruefeDatenbank(config.store.databaseUrl, herzschlagFristMs);
      } catch (fehler) {
        console.warn(`[lebenszeichen] nicht gemeldet: Datenbank nicht gesund: ${fehlerart(fehler)}`);
        return;
      } finally {
        datenbankPruefungLaeuft = false;
      }
    }
    void meldeHerzschlag(adresse, herzschlagFristMs);
  };
  setInterval(() => void takt(), herzschlagTaktMs).unref();
}
