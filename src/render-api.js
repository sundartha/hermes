export const RENDER_API_BASE = "https://api.render.com/v1";
const RENDER_ABRUF_TIMEOUT_MS = 15000;
const JSON_TYP = "application/json";
const HTTP_OK = 200;
const METHODE_GET = "GET";
const METHODE_PUT = "PUT";

export function renderDienstPfad(serviceId) {
  return `/services/${encodeURIComponent(serviceId)}`;
}

function envVarPfad({ serviceId, schluessel }) {
  if (typeof schluessel !== "string" || schluessel === "") throw new Error("Render-Env-Schluessel fehlt");
  return `${renderDienstPfad(serviceId)}/env-vars/${encodeURIComponent(schluessel)}`;
}

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

export async function leseRenderEnvVar({ fetchImpl, apiKey, serviceId, schluessel }) {
  const antwort = await renderAnfrage({ fetchImpl, apiKey, pfad: envVarPfad({ serviceId, schluessel }) });
  if (antwort.status !== HTTP_OK) return { status: antwort.status, wert: null };
  const koerper = await antwort.json();
  return { status: antwort.status, wert: typeof koerper?.value === "string" ? koerper.value : null };
}

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

export async function leseRenderDienst({ fetchImpl, apiKey, serviceId }) {
  const antwort = await renderAnfrage({ fetchImpl, apiKey, pfad: renderDienstPfad(serviceId) });
  if (antwort.status !== HTTP_OK) return { status: antwort.status, koerper: null };
  return { status: antwort.status, koerper: await antwort.json() };
}
