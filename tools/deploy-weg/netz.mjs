const ANFRAGE_FRIST_MS = 15000;
const JSON_TYP = "application/json";
const GITHUB_TYP = "application/vnd.github+json";
const GITHUB_VERSION = "2022-11-28";
const KENNUNG = "hermes-deploy-weg";
const MCP_TYP = "application/json, text/event-stream";
const HTTP_OK = 200;
const KEINE_ANTWORT = 0;
const DEPLOY_PFAD = "/deploys";
const LISTE_GROESSE = 20;
const TOOLS_LIST = Object.freeze({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

function datenAus(text) {
  try {
    return text === "" ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export async function anfrage(url, { methode = "GET", kopf = {}, koerper } = {}) {
  const headers = { accept: JSON_TYP, "user-agent": KENNUNG, ...kopf };
  if (koerper !== undefined) headers["content-type"] = JSON_TYP;
  try {
    const antwort = await fetch(url, {
      method: methode,
      headers,
      body: koerper === undefined ? undefined : JSON.stringify(koerper),
      redirect: "error",
      signal: AbortSignal.timeout(ANFRAGE_FRIST_MS),
    });
    return { status: antwort.status, daten: datenAus(await antwort.text()) };
  } catch {
    return { status: KEINE_ANTWORT, daten: null };
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

export function renderZugang({ renderUrl, renderSchluessel, serviceId }) {
  const kopf = { authorization: "Bearer " + renderSchluessel };
  const basis = renderUrl + "/services/" + encodeURIComponent(serviceId) + DEPLOY_PFAD;
  const einzeln = (id) => basis + "/" + encodeURIComponent(id);
  return Object.freeze({
    ausloesen: (commit) => anfrage(basis, { methode: "POST", kopf, koerper: { commitId: commit } }),
    liste: () => anfrage(basis + "?limit=" + LISTE_GROESSE, { kopf }),
    lesen: (id) => anfrage(einzeln(id), { kopf }),
    abbrechen: (id) => anfrage(einzeln(id) + "/cancel", { methode: "POST", kopf }),
  });
}

function anzahlLaufend(daten) {
  const wert = daten?.laufend;
  return Number.isInteger(wert) && wert >= 0 ? wert : null;
}

export function hermesZugang(basisUrl, deployToken = null) {
  return Object.freeze({
    async commit() {
      const { status, daten } = await anfrage(basisUrl + "/healthz");
      return status === HTTP_OK && typeof daten?.commit === "string" ? daten.commit : null;
    },
    async anrufe() {
      const kopf = { authorization: "Bearer " + deployToken, "cache-control": "no-store" };
      const { status, daten } = await anfrage(basisUrl + "/intern/anrufe-laufend", { kopf });
      return { status, laufend: status === HTTP_OK ? anzahlLaufend(daten) : null };
    },
    async mcpOhneAnmeldung() {
      const kopf = { accept: MCP_TYP };
      const optionen = { methode: "POST", kopf, koerper: TOOLS_LIST };
      const { status } = await anfrage(basisUrl + "/mcp", optionen);
      return status;
    },
  });
}
