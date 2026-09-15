// ---- Render-API: der EINE Zugang der Werkzeuge (IEL-B9 Ziel-Urteil, IEL-B10 Geheimnisse) -----
// Nur Werkzeuge nutzen dieses Modul (scripts/push-elevenlabs.mjs ueber init-webhook-ziel.js,
// scripts/iel-geheimnisse*.mjs); der Server spricht nie mit Render.
//
// DIE RENDER-BASIS IST EINE KONSTANTE, kein Env-Wert: sonst lenkte eine lokale .env den
// RENDER_API_KEY auf einen fremden Host. RENDER_API_KEY ist ein Werkzeug-Schluessel (voller
// Workspace-Zugriff); der Aufrufer reicht ihn herein, er steht nur im Authorization-Header und
// nie in einem Ergebnis.
//
// DER LISTEN-ENDPUNKT IST BAULICH UNERREICHBAR: PUT /services/{id}/env-vars (ohne Schluessel)
// ersetzt die GESAMTE Env des Dienstes. envVarPfad wirft deshalb bei leerem Schluessel VOR
// jedem fetch, und es gibt keine Funktion, die den Sammelpfad adressiert.
//
// RENDER-API, BELEGT aus api-docs.render.com (gelesen 2026-09-15), Basis https://api.render.com/v1:
//   GET /services/{serviceId}                        -> serviceDetails.url (200; sonst 401/403/404/406/410/429/500/503)
//   GET /services/{serviceId}/env-vars/{envVarKey}   -> {key, value} (200; 404 "when key not found")
//   PUT /services/{serviceId}/env-vars/{envVarKey}   Koerper {value} -> 200 {key, value}; sonst
//       400/401/403/404/406/410/429/500/503 (reference/update-env-var). Gilt nur fuer Variablen
//       direkt am Dienst, nicht fuer Environment-Groups. OB DER PUT EINEN DEPLOY AUSLOEST, sagt
//       die Doku NICHT (UNBELEGT, PLAN-SECURITY.md IEL-B10).
//   GET /services/{serviceId}/custom-domains?limit=  -> [{customDomain:{name, verificationStatus}, cursor}] (max 100)
// Ein 404 beim Env-GET heisst NUR dann "nicht gesetzt", wenn ein Service-GET davor 200 lieferte -
// sonst koennte er auch "Service unbekannt" heissen. Das entscheidet der Aufrufer.

export const RENDER_API_BASE = "https://api.render.com/v1";
const RENDER_ABRUF_TIMEOUT_MS = 15000;
const JSON_TYP = "application/json";
const HTTP_OK = 200;
const METHODE_GET = "GET";
const METHODE_PUT = "PUT";

export function renderDienstPfad(serviceId) {
  return `/services/${encodeURIComponent(serviceId)}`;
}

// Fail-closed: ein leerer Schluessel adressierte den Listen-Endpunkt (s. Kopf) -> Wurf vor fetch.
function envVarPfad({ serviceId, schluessel }) {
  if (typeof schluessel !== "string" || schluessel === "") throw new Error("Render-Env-Schluessel fehlt");
  return `${renderDienstPfad(serviceId)}/env-vars/${encodeURIComponent(schluessel)}`;
}

// Der eine Transport: Bearer + accept json, content-type nur bei Koerper, Timeout Pflicht.
export function renderAnfrage({ fetchImpl, apiKey, pfad, init = {} }) {
  const headers = { Authorization: `Bearer ${apiKey}`, accept: JSON_TYP };
  if (init.body !== undefined) headers["content-type"] = JSON_TYP;
  return fetchImpl(`${RENDER_API_BASE}${pfad}`, {
    method: METHODE_GET,
    ...init,
    headers,
    signal: AbortSignal.timeout(RENDER_ABRUF_TIMEOUT_MS),
  });
}

// 200 -> {status, wert: string|null}; sonst {status, wert: null}. Bei Nicht-200 wird KEIN
// Koerper gelesen.
export async function leseRenderEnvVar({ fetchImpl, apiKey, serviceId, schluessel }) {
  const antwort = await renderAnfrage({ fetchImpl, apiKey, pfad: envVarPfad({ serviceId, schluessel }) });
  if (antwort.status !== HTTP_OK) return { status: antwort.status, wert: null };
  const koerper = await antwort.json();
  return { status: antwort.status, wert: typeof koerper?.value === "string" ? koerper.value : null };
}

// SCHREIBZUGRIFF. Liefert nur {status}: der Antwortkoerper traegt den Wert und wird nie gelesen.
export async function schreibeRenderEnvVar({ fetchImpl, apiKey, serviceId, schluessel, wert }) {
  const pfad = envVarPfad({ serviceId, schluessel });
  const antwort = await renderAnfrage({
    fetchImpl,
    apiKey,
    pfad,
    init: { method: METHODE_PUT, body: JSON.stringify({ value: wert }) },
  });
  return { status: antwort.status };
}

// {status, koerper|null}; der Koerper nur bei 200.
export async function leseRenderDienst({ fetchImpl, apiKey, serviceId }) {
  const antwort = await renderAnfrage({ fetchImpl, apiKey, pfad: renderDienstPfad(serviceId) });
  if (antwort.status !== HTTP_OK) return { status: antwort.status, koerper: null };
  return { status: antwort.status, koerper: await antwort.json() };
}
