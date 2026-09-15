// ---- Ziel des workspace-weiten Init-Webhooks (IEL-B9, Spec E21) ------------------------
// EINZIGE QUELLE des Init-Ziels. Die Adresse, die ElevenLabs bei JEDEM eingehenden Gespraech
// des Workspace ruft, ist eine Repo-Konstante (initWebhookUrl) - sie stammt NIE aus der
// lokalen .env und NIE aus der oeffentlichen Adresse der Server-Konfiguration. Eine lokal
// gesetzte Tunnel-Adresse wuerde sonst den Anbieter auf einen Laptop lenken, und jedes
// Gespraech mit Tenant-Kontext liefe dorthin.
//
// ZIEL-URTEIL: bevor die Konstante geschrieben wird, prueft das Urteil am LAUFENDEN Dienst,
// dass sie ihn wirklich erreicht. Gelesen wird ausschliesslich die Render-API fuer
// HERMES_RENDER_SERVICE_ID (nur GET): der wirksame Origin (Vorrang wie src/config.js:
// PUBLIC_URL || RENDER_EXTERNAL_URL) muss https sein und in HERMES_GATEWAY_ORIGINS stehen, und
// der Host der Init-Adresse muss dem Dienst als verifizierte Custom-Domain zugeordnet sein.
//
// RENDER-ZUGRIFF ausschliesslich ueber src/render-api.js: dort stehen die Basis als Konstante
// (kein Env-Wert), der Transport und die Belege der Endpunkte. Hier nur GET; RENDER_API_KEY
// (Werkzeug-Schluessel, voller Workspace-Zugriff) reicht der Aufrufer herein, er steht in keinem
// Ergebnisfeld. Ein 404 beim Env-GET zaehlt NUR als "nicht gesetzt", weil der Service-GET davor
// 200 lieferte - sonst koennte er auch "Service unbekannt" heissen.
import { ELEVENLABS_INIT_PATH } from "../routes/webhooks-elevenlabs-init.js";
import { leseRenderDienst, leseRenderEnvVar, renderAnfrage, renderDienstPfad } from "../render-api.js";

export const INIT_WEBHOOK_ORIGIN = "https://app.sundartha.com";
export const HERMES_GATEWAY_ORIGINS = Object.freeze(["https://app.sundartha.com", "https://vodafone-agent.onrender.com"]);
export const HERMES_RENDER_SERVICE_ID = "srv-d8m0fhflk1mc73bno570";
const PUBLIC_URL_ENV_SCHLUESSEL = "PUBLIC_URL";
// Hoechstwert der Seitengroesse laut Doku. Eine volle Seite heisst "es kann mehr geben" - ohne
// Blaettern ist die Liste dann kein Beleg (fail-closed statt Cursor-Logik).
const RENDER_CUSTOM_DOMAINS_LIMIT = 100;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTPS_PROTOKOLL = "https:";
const DOMAIN_VERIFIZIERT = "verified";

export const ZIEL_URTEIL = Object.freeze({ GRUEN: "gruen", ROT: "rot" });
export const ZIEL_GRUND = Object.freeze({
  API_KEY_FEHLT: "render_api_key_fehlt",
  RENDER_NICHT_ERREICHBAR: "render_nicht_erreichbar",
  // Begleitet vom HTTP-Status im Feld status.
  RENDER_STATUS: "render_status",
  DOMAINS_UNVOLLSTAENDIG: "custom_domains_unvollstaendig",
  ORIGIN_LEER: "origin_leer",
  ORIGIN_UNGUELTIG: "origin_ungueltig",
  ORIGIN_NICHT_HTTPS: "origin_nicht_https",
  ORIGIN_NICHT_ERLAUBT: "origin_nicht_erlaubt",
  HOST_NICHT_ZUGEORDNET: "init_host_nicht_zugeordnet",
});

export function initWebhookUrl() {
  return `${INIT_WEBHOOK_ORIGIN}${ELEVENLABS_INIT_PATH}`;
}

// ---- Lesen am Dienst (nur GET, seriell, Abbruch beim ersten Nicht-OK) ------------------

function unlesbar(grund, status) {
  return status === undefined ? { lesbar: false, grund } : { lesbar: false, grund, status };
}

// null statt Wurf: eine unparsebare Adresse ist ein Befund, kein Absturz.
function urlVon(adresse) {
  try {
    return new URL(adresse);
  } catch {
    return null;
  }
}

// Die Hosts, unter denen der Dienst erreichbar ist: seine eigene Render-Adresse plus jede
// VERIFIZIERTE Custom-Domain. Eine unverifizierte Domain ist kein Beleg, dass sie ihn erreicht.
function dienstHostsAus({ serviceUrl, domains }) {
  const verifiziert = domains
    .filter((eintrag) => eintrag?.customDomain?.verificationStatus === DOMAIN_VERIFIZIERT)
    .map((eintrag) => eintrag.customDomain.name);
  return [urlVon(serviceUrl)?.host, ...verifiziert].filter((host) => typeof host === "string" && host !== "");
}

async function leseServiceUrl(zugriff) {
  const { status, koerper } = await leseRenderDienst(zugriff);
  if (status !== HTTP_OK) return { fehler: unlesbar(ZIEL_GRUND.RENDER_STATUS, status) };
  return { wert: koerper?.serviceDetails?.url ?? null };
}

// Laeuft NUR nach einem Service-GET mit 200 - erst dadurch heisst 404 "Schluessel nicht gesetzt".
async function lesePublicUrlEnv(zugriff) {
  const { status, wert } = await leseRenderEnvVar({ ...zugriff, schluessel: PUBLIC_URL_ENV_SCHLUESSEL });
  if (status === HTTP_NOT_FOUND) return { wert: null };
  if (status !== HTTP_OK) return { fehler: unlesbar(ZIEL_GRUND.RENDER_STATUS, status) };
  return { wert };
}

async function leseCustomDomains({ fetchImpl, apiKey, serviceId }) {
  const pfad = `${renderDienstPfad(serviceId)}/custom-domains?limit=${RENDER_CUSTOM_DOMAINS_LIMIT}`;
  const antwort = await renderAnfrage({ fetchImpl, apiKey, pfad });
  if (antwort.status !== HTTP_OK) return { fehler: unlesbar(ZIEL_GRUND.RENDER_STATUS, antwort.status) };
  const eintraege = await antwort.json();
  const vollstaendig = Array.isArray(eintraege) && eintraege.length < RENDER_CUSTOM_DOMAINS_LIMIT;
  if (!vollstaendig) return { fehler: unlesbar(ZIEL_GRUND.DOMAINS_UNVOLLSTAENDIG) };
  return { wert: eintraege };
}

async function leseDienst(zugriff) {
  const service = await leseServiceUrl(zugriff);
  if (service.fehler) return service.fehler;
  const publicUrl = await lesePublicUrlEnv(zugriff);
  if (publicUrl.fehler) return publicUrl.fehler;
  const domains = await leseCustomDomains(zugriff);
  if (domains.fehler) return domains.fehler;
  return {
    lesbar: true,
    publicUrlEnv: publicUrl.wert,
    serviceUrl: service.wert,
    dienstHosts: dienstHostsAus({ serviceUrl: service.wert, domains: domains.wert }),
  };
}

// Liefert { lesbar:true, publicUrlEnv, serviceUrl, dienstHosts } | { lesbar:false, grund, status? }.
// Wirft nie: ein Netz- oder Parse-Fehler ist "nicht erreichbar". Ohne Schluessel kein fetch.
export async function renderDienstZiel({ fetchImpl, apiKey, serviceId }) {
  if (!apiKey) return unlesbar(ZIEL_GRUND.API_KEY_FEHLT);
  try {
    return await leseDienst({ fetchImpl, apiKey, serviceId });
  } catch {
    return unlesbar(ZIEL_GRUND.RENDER_NICHT_ERREICHBAR);
  }
}

// ---- Urteil (rein) ----------------------------------------------------------------------

function rot({ grund, wirksamerOrigin = null, status }) {
  const urteil = { urteil: ZIEL_URTEIL.ROT, grund, wirksamerOrigin };
  return status === undefined ? urteil : { ...urteil, status };
}

// Rein. Vorrang wie src/config.js (PUBLIC_URL || RENDER_EXTERNAL_URL): ein leerer PUBLIC_URL
// faellt auf die Service-Adresse zurueck. Liefert { urteil, grund|null, wirksamerOrigin|null }.
export function zielUrteil(dienst) {
  if (!dienst.lesbar) return rot({ grund: dienst.grund, status: dienst.status });
  const wirksam = dienst.publicUrlEnv || dienst.serviceUrl;
  if (!wirksam) return rot({ grund: ZIEL_GRUND.ORIGIN_LEER });
  const adresse = urlVon(wirksam);
  if (!adresse) return rot({ grund: ZIEL_GRUND.ORIGIN_UNGUELTIG });
  const wirksamerOrigin = adresse.origin;
  if (adresse.protocol !== HTTPS_PROTOKOLL) return rot({ grund: ZIEL_GRUND.ORIGIN_NICHT_HTTPS, wirksamerOrigin });
  if (!HERMES_GATEWAY_ORIGINS.includes(wirksamerOrigin)) return rot({ grund: ZIEL_GRUND.ORIGIN_NICHT_ERLAUBT, wirksamerOrigin });
  if (!dienst.dienstHosts.includes(new URL(INIT_WEBHOOK_ORIGIN).host)) {
    return rot({ grund: ZIEL_GRUND.HOST_NICHT_ZUGEORDNET, wirksamerOrigin });
  }
  return { urteil: ZIEL_URTEIL.GRUEN, grund: null, wirksamerOrigin };
}
