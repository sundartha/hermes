export const MAX_FEHLERQUOTE_PROZENT = 0.5;
export const MAX_VERLORENE_ANRUFE = 0;
export const MAX_WARTEZEIT_SEKUNDEN = 120;

function istZahl(wert) {
  return typeof wert === "number" && Number.isFinite(wert) && wert >= 0;
}

function pruefeRoute(route) {
  if (route === null || typeof route !== "object") return "route_ungueltig";
  if (!istZahl(route.istMs) || !istZahl(route.budgetMs)) return `messwert_fehlt:${route.name}`;
  return route.istMs > route.budgetMs ? `route_ueber_budget:${route.name}` : undefined;
}

function pruefeRouten(routen) {
  if (!Array.isArray(routen) || routen.length === 0) return ["messwert_fehlt:routen"];
  return routen.map(pruefeRoute).filter((grund) => grund !== undefined);
}

function pruefeZahl(wert, name, istOk) {
  if (!istZahl(wert)) return [`messwert_fehlt:${name}`];
  return istOk(wert) ? [] : [name];
}

export function bewerteLauf(ergebnis) {
  const werte = ergebnis ?? {};
  const gruende = [
    ...pruefeZahl(werte.fehlerquoteProzent, "fehlerquote", (w) => w < MAX_FEHLERQUOTE_PROZENT),
    ...pruefeZahl(werte.verloreneAnrufe, "verlorene_anrufe", (w) => w <= MAX_VERLORENE_ANRUFE),
    ...pruefeZahl(werte.wartezeitSekunden, "wartezeit", (w) => w <= MAX_WARTEZEIT_SEKUNDEN),
    ...pruefeRouten(werte.routen),
  ];
  return { gruen: gruende.length === 0, gruende };
}
