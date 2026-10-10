import { COMMIT_MUSTER } from "./ausgabe.mjs";
import { minuten } from "./takt.mjs";

const ANFRAGE_FRIST_MS = 15000;
const JSON_TYP = "application/json";
const GITHUB_TYP = "application/vnd.github+json";
const GITHUB_VERSION = "2022-11-28";
const KENNUNG = "hermes-deploy-weg";
const MCP_TYP = "application/json, text/event-stream";
const HTTP_OK = 200;
const KEINE_ANTWORT = 0;
const DEPLOY_PFAD = "/deploys";
const HEALTHZ_PFAD = "/healthz";
const ANRUFPAUSE_PFAD = "/intern/anrufpause";
const LISTE_GROESSE = 20;
const EREIGNIS_GROESSE = "100";
const TOOLS_LIST = Object.freeze({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

function datenAus(text) {
  try {
    return text === "" ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export async function anfrage(
  url,
  { methode = "GET", kopf = {}, koerper, fristMs = ANFRAGE_FRIST_MS } = {},
) {
  const headers = { accept: JSON_TYP, "user-agent": KENNUNG, ...kopf };
  if (koerper !== undefined) headers["content-type"] = JSON_TYP;
  try {
    const antwort = await fetch(url, {
      method: methode,
      headers,
      body: koerper === undefined ? undefined : JSON.stringify(koerper),
      redirect: "error",
      signal: AbortSignal.timeout(fristMs),
    });
    const typ = antwort.headers.get("content-type") ?? "";
    return { status: antwort.status, typ, daten: datenAus(await antwort.text()) };
  } catch {
    return { status: KEINE_ANTWORT, typ: "", daten: null };
  }
}

function wachAntwort({ status, typ, daten }) {
  const commit = daten?.commit;
  return (
    status === HTTP_OK &&
    typ.startsWith(JSON_TYP) &&
    typeof commit === "string" &&
    COMMIT_MUSTER.test(commit)
  );
}

async function wachPruefen(url, { uhr, fristMs }) {
  const vorher = uhr.jetzt();
  const wach = wachAntwort(await anfrage(url, { fristMs }));
  return { wach, dauer: uhr.jetzt() - vorher };
}

export async function aufwecken(basisUrl, { uhr, takte, grenzeMs }) {
  const start = uhr.jetzt();
  const grenze = Math.min(takte.schutzgrenzeMs, grenzeMs);
  const url = basisUrl + HEALTHZ_PFAD;
  for (let runde = 0; ; runde += 1) {
    const vergangen = uhr.jetzt() - start;
    if (vergangen >= grenze) return { schutzgrenze: true, minuten: minuten(vergangen) };
    const fristMs = Math.min(takte.fristMs, grenze - vergangen);
    const { wach, dauer } = await wachPruefen(url, { uhr, fristMs });
    if (wach) return { frischGeweckt: runde > 0 || dauer > takte.frischAbMs };
    const rest = grenze - (uhr.jetzt() - start);
    if (rest > 0) await uhr.warten(Math.min(takte.taktMs, rest));
  }
}

export function githubZugang({ githubUrl, githubToken, repository }) {
  const kopf = {
    authorization: "Bearer " + githubToken,
    accept: GITHUB_TYP,
    "x-github-api-version": GITHUB_VERSION,
  };
  const basis = githubUrl + "/repos/" + repository;
  return Object.freeze({
    repository,
    lesen: (pfad) => anfrage(basis + pfad, { kopf }),
    senden: ({ methode, pfad, koerper }) => anfrage(basis + pfad, { methode, kopf, koerper }),
  });
}

function ereignisFilter(seit) {
  const filter = new URLSearchParams({
    type: "deploy_started",
    startTime: seit,
    limit: EREIGNIS_GROESSE,
  });
  return "/events?" + filter.toString();
}

export function renderZugang({ renderUrl, renderSchluessel, serviceId }) {
  const kopf = { authorization: "Bearer " + renderSchluessel };
  const dienst = renderUrl + "/services/" + encodeURIComponent(serviceId);
  const basis = dienst + DEPLOY_PFAD;
  const einzeln = (id) => basis + "/" + encodeURIComponent(id);
  return Object.freeze({
    ausloesen: (commit) => anfrage(basis, { methode: "POST", kopf, koerper: { commitId: commit } }),
    liste: () => anfrage(basis + "?limit=" + LISTE_GROESSE, { kopf }),
    lesen: (id) => anfrage(einzeln(id), { kopf }),
    abbrechen: (id) => anfrage(einzeln(id) + "/cancel", { methode: "POST", kopf }),
    dienst: () => anfrage(dienst, { kopf }),
    dienstAendern: (koerper) => anfrage(dienst, { methode: "PATCH", kopf, koerper }),
    zurueckrollen: (deployId) =>
      anfrage(dienst + "/rollback", { methode: "POST", kopf, koerper: { deployId } }),
    ereignisse: (seit) => anfrage(dienst + ereignisFilter(seit), { kopf }),
  });
}

function anzahlLaufend(daten) {
  const wert = daten?.laufend;
  return Number.isInteger(wert) && wert >= 0 ? wert : null;
}

export function hermesZugang(basisUrl, deployToken = null) {
  const internKopf = { authorization: "Bearer " + deployToken, "cache-control": "no-store" };
  return Object.freeze({
    async commit() {
      const { status, daten } = await anfrage(basisUrl + HEALTHZ_PFAD);
      return status === HTTP_OK && typeof daten?.commit === "string" ? daten.commit : null;
    },
    aufwecken: (optionen) => aufwecken(basisUrl, optionen),
    async wachhalten() {
      await anfrage(basisUrl + HEALTHZ_PFAD);
    },
    async anrufe() {
      const { status, daten } = await anfrage(basisUrl + "/intern/anrufe-laufend", {
        kopf: internKopf,
      });
      return { status, laufend: status === HTTP_OK ? anzahlLaufend(daten) : null };
    },
    anrufpauseLesen: () => anfrage(basisUrl + ANRUFPAUSE_PFAD, { kopf: internKopf }),
    anrufpauseSetzen: (an) =>
      anfrage(basisUrl + ANRUFPAUSE_PFAD, { methode: "POST", kopf: internKopf, koerper: { an } }),
    async mcpOhneAnmeldung() {
      const kopf = { accept: MCP_TYP };
      const optionen = { methode: "POST", kopf, koerper: TOOLS_LIST };
      const { status } = await anfrage(basisUrl + "/mcp", optionen);
      return status;
    },
  });
}
