import { HTTP_OK } from "./utils/http.ts";
export const RENDER_API_BASE = "https://api.render.com/v1";
const RENDER_ABRUF_TIMEOUT_MS = 15000;
const JSON_TYP = "application/json";
const METHODE_GET = "GET";
const METHODE_PUT = "PUT";

interface Antwort<K> {
  status: number;
  json: () => Promise<K>;
}

type FetchImpl<K> = (url: string, init: RequestInit & { fristMs: number }) => Promise<Antwort<K>>;

interface EnvVarKoerper {
  value?: unknown;
}

interface Zugang<K> {
  fetchImpl: FetchImpl<K>;
  apiKey: string;
}

interface DienstZugang<K> extends Zugang<K> {
  serviceId: string;
}

interface EnvVarZugang<K> extends DienstZugang<K> {
  schluessel: unknown;
}

type AnfrageZiel<K> = Zugang<K> & { pfad: string; init?: RequestInit };
type LeseEnvVar = EnvVarZugang<EnvVarKoerper | null>;
type SchreibeEnvVar = EnvVarZugang<unknown> & { wert: unknown };
interface Status {
  status: number;
}
interface EnvVarWert extends Status {
  wert: string | null;
}
interface DienstKoerper extends Status {
  koerper: unknown;
}

export function renderDienstPfad(serviceId: string): string {
  return `/services/${encodeURIComponent(serviceId)}`;
}

function envVarPfad({ serviceId, schluessel }: { serviceId: string; schluessel: unknown }): string {
  if (typeof schluessel !== "string" || schluessel === "") throw new Error("Render-Env-Schluessel fehlt");
  return `${renderDienstPfad(serviceId)}/env-vars/${encodeURIComponent(schluessel)}`;
}

export function renderAnfrage<K>({ fetchImpl, apiKey, pfad, init = {} }: AnfrageZiel<K>): Promise<Antwort<K>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, accept: JSON_TYP };
  if (init.body !== undefined) headers["content-type"] = JSON_TYP;
  return fetchImpl(`${RENDER_API_BASE}${pfad}`, {
    method: METHODE_GET,
    ...init,
    headers,
    signal: AbortSignal.timeout(RENDER_ABRUF_TIMEOUT_MS),
    fristMs: RENDER_ABRUF_TIMEOUT_MS,
  });
}

export async function leseRenderEnvVar({ fetchImpl, apiKey, serviceId, schluessel }: LeseEnvVar): Promise<EnvVarWert> {
  const antwort = await renderAnfrage({ fetchImpl, apiKey, pfad: envVarPfad({ serviceId, schluessel }) });
  if (antwort.status !== HTTP_OK) return { status: antwort.status, wert: null };
  const koerper = await antwort.json();
  return { status: antwort.status, wert: typeof koerper?.value === "string" ? koerper.value : null };
}

export async function schreibeRenderEnvVar({ fetchImpl, apiKey, serviceId, schluessel, wert }: SchreibeEnvVar): Promise<Status> {
  const pfad = envVarPfad({ serviceId, schluessel });
  const antwort = await renderAnfrage({
    fetchImpl,
    apiKey,
    pfad,
    init: { method: METHODE_PUT, body: JSON.stringify({ value: wert }) },
  });
  return { status: antwort.status };
}

export async function leseRenderDienst({ fetchImpl, apiKey, serviceId }: DienstZugang<unknown>): Promise<DienstKoerper> {
  const antwort = await renderAnfrage({ fetchImpl, apiKey, pfad: renderDienstPfad(serviceId) });
  if (antwort.status !== HTTP_OK) return { status: antwort.status, koerper: null };
  return { status: antwort.status, koerper: await antwort.json() };
}
