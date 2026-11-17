const PROZENT = 100;
const MS_JE_SEKUNDE = 1000;
const FEHLERTEXT_MAX = 120;
const FEHLER_MARKE = "ablauf_fehler | ";
const FELDER_VOR_TEXT = 3;
const NUMMER = /\+\d{6,}|\d{8,}/g;
const BEARER = /\bBearer\s+\S+/gi;
const TOKEN = /(token["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi;
const K6_RAHMEN_ENDE = /" source=console\s*$/;

export const ROUTEN_BUDGET_MS = Object.freeze({
  route_mcp_anmeldung: 500,
  route_place_call: 1000,
  route_anruf_status: 500,
  route_anruf_ergebnis: 500,
  route_webhook_telnyx: 300,
  route_webhook_elevenlabs: 300,
  route_app_login: 1000,
});

function messwert(daten, name, schluessel) {
  const metriken = daten?.metrics;
  const werte = metriken?.[name]?.values;
  const wert = werte?.[schluessel];
  return typeof wert === "number" ? wert : undefined;
}

function fehlerquote(daten) {
  const anfragen = messwert(daten, "http_reqs", "count");
  const fehlgeschlagen = messwert(daten, "http_req_failed", "passes");
  const ablaufFehler = messwert(daten, "ablauf_fehler", "count");
  if (!anfragen || fehlgeschlagen === undefined || ablaufFehler === undefined) return undefined;
  return ((fehlgeschlagen + ablaufFehler) / anfragen) * PROZENT;
}

function verloreneAnrufe(daten) {
  const gestartet = messwert(daten, "anrufe_gestartet", "count");
  const beendet = messwert(daten, "anrufe_beendet", "count");
  if (!gestartet || beendet === undefined) return undefined;
  return gestartet - beendet;
}

function wartezeitSekunden(daten) {
  const laengste = messwert(daten, "anruf_wartezeit", "max");
  return laengste === undefined ? undefined : laengste / MS_JE_SEKUNDE;
}

function routen(daten, ausgelassen) {
  return Object.entries(ROUTEN_BUDGET_MS)
    .filter(([name]) => !ausgelassen.includes(name))
    .map(([name, budgetMs]) => ({ name, budgetMs, istMs: messwert(daten, name, "p(95)") }));
}

export function waehleSzenarien(alle, namen) {
  if (namen === undefined) return alle;
  return Object.fromEntries(Object.entries(alle).filter(([name]) => namen.includes(name)));
}

export function baueErgebnis(daten, ausgelassen = []) {
  return {
    anfragen: messwert(daten, "http_reqs", "count"),
    httpFehlgeschlagen: messwert(daten, "http_req_failed", "passes"),
    ablaufFehler: messwert(daten, "ablauf_fehler", "count"),
    fehlerquoteProzent: fehlerquote(daten),
    verloreneAnrufe: verloreneAnrufe(daten),
    wartezeitSekunden: wartezeitSekunden(daten),
    routen: routen(daten, ausgelassen),
  };
}

export function fehlerZeile({ szenario, route, text }) {
  const geschwaerzt = String(text).replace(BEARER, "<geheim>").replace(TOKEN, "$1<geheim>").replace(NUMMER, "<nummer>");
  const einzeilig = geschwaerzt.replace(/\s+/g, " ").replace(/"/g, "'");
  return `${FEHLER_MARKE}${szenario} | ${route} | ${einzeilig.slice(0, FEHLERTEXT_MAX)}`;
}

function fehlertextAus(zeile) {
  const stelle = zeile.indexOf(FEHLER_MARKE);
  if (stelle < 0) return undefined;
  const felder = zeile.slice(stelle).replace(K6_RAHMEN_ENDE, "").split(" | ");
  return felder.slice(FELDER_VOR_TEXT).join(" | ");
}

export function fasseFehlerZusammen(zeilen) {
  const anzahl = new Map();
  for (const zeile of zeilen) {
    const text = fehlertextAus(zeile);
    if (text !== undefined) anzahl.set(text, (anzahl.get(text) ?? 0) + 1);
  }
  return [...anzahl].sort((links, rechts) => rechts[1] - links[1]).map(([text, menge]) => `ablauf_fehler Zusammenfassung | ${menge}x | ${text}`);
}
