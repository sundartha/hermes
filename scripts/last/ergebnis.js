const PROZENT = 100;
const MS_JE_SEKUNDE = 1000;

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

function routen(daten) {
  return Object.entries(ROUTEN_BUDGET_MS).map(([name, budgetMs]) => ({
    name,
    budgetMs,
    istMs: messwert(daten, name, "p(95)"),
  }));
}

export function baueErgebnis(daten) {
  return {
    fehlerquoteProzent: fehlerquote(daten),
    verloreneAnrufe: verloreneAnrufe(daten),
    wartezeitSekunden: wartezeitSekunden(daten),
    routen: routen(daten),
  };
}
