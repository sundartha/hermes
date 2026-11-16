import { STUFE_DAUER } from "./arten.mjs";
import { ersterEngpass, GRENZEN } from "./engpass.mjs";
import { bewerteLauf } from "./schwellen.mjs";

const STUFE_START = 20;
const STUFE_SCHRITT = 10;
const STUFE_ENDE = 100;
const ABFRAGE_FRIST_MS = 10_000;
const HTTP_OK = 200;
const STUFEN = Object.freeze(Array.from({ length: (STUFE_ENDE - STUFE_START) / STUFE_SCHRITT + 1 }, (leer, nummer) => STUFE_START + nummer * STUFE_SCHRITT));
const METRIKEN = Object.freeze([
  ["eventloopP99Ms", "hermes_eventloop_delay_p99"],
  ["dbPoolWartend", "hermes_db_pool_waiting"],
  ["warteschlangeAlterS", "hermes_queue_oldest_age"],
]);

export function abbruch(grund) {
  throw new Error(`Staging-Lastlauf abgebrochen: ${grund}`);
}

async function leseMetrik({ abfrage, adresse, token }, name) {
  const url = new URL(`${adresse}/api/v1/query`);
  url.searchParams.set("query", `max_over_time(max(${name})[${STUFE_DAUER}:])`);
  const optionen = { headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(ABFRAGE_FRIST_MS) };
  const antwort = await abfrage(url.href, optionen).catch(() => abbruch("metrik_nicht_erreichbar"));
  const koerper = antwort.status === HTTP_OK ? await antwort.json().catch(() => ({})) : {};
  const [reihe] = koerper?.data?.result ?? [];
  const wert = Number(reihe?.value?.[1]);
  return Number.isFinite(wert) ? wert : abbruch("metrik_unlesbar");
}

async function leseServerwerte(zugang) {
  const werte = await Promise.all(METRIKEN.map(([, name]) => leseMetrik(zugang, name)));
  return Object.fromEntries(METRIKEN.map(([schluessel], stelle) => [schluessel, werte[stelle]]));
}

function hoechsteRoute(routen) {
  return Math.max(...(routen ?? []).map((route) => route.istMs));
}

async function messeStufe({ anrufe, fuehreAus, k6Befehl, konfiguration, zugang }) {
  const ergebnis = await fuehreAus(k6Befehl, { ...konfiguration, anrufe });
  const urteil = bewerteLauf(ergebnis);
  const punkt = {
    anrufe,
    fehlerquoteProzent: ergebnis.fehlerquoteProzent,
    httpP95Ms: hoechsteRoute(ergebnis.routen),
    ...(await leseServerwerte(zugang)),
    schwellen: urteil.gruende,
  };
  return { ergebnis, urteil, punkt };
}

export async function laufeStufen(umgebung) {
  const kurve = [];
  let erste;
  for (const anrufe of STUFEN) {
    const stufe = await messeStufe({ ...umgebung, anrufe });
    erste ??= stufe;
    kurve.push(stufe.punkt);
    const engpass = ersterEngpass(kurve, GRENZEN);
    if (engpass !== undefined || !stufe.urteil.gruen) return { ergebnis: erste.ergebnis, urteil: erste.urteil, kurve, engpass };
  }
  return { ergebnis: erste.ergebnis, urteil: erste.urteil, kurve, engpass: undefined };
}

export function fasseZusammen(kurve, engpass) {
  const letzte = kurve.at(-1);
  if (engpass !== undefined) {
    return `Erster Engpass: ${engpass.groesse} bei ${engpass.stufe} gleichzeitigen Anrufen (Wert ${engpass.wert}, Grenze ${engpass.grenze})`;
  }
  if (letzte.schwellen.length > 0) return `Schwelle gerissen bei ${letzte.anrufe} gleichzeitigen Anrufen: ${letzte.schwellen.join(", ")}`;
  return `Kein Engpass bis ${letzte.anrufe} gleichzeitige Anrufe`;
}
