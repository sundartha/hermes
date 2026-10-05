import { env } from "node:process";

const GITHUB_API = "https://api.github.com";
const STANDARD_REPO = "sundartha/hermes";
export const PRO_SEITE = 100;

function kopfzeilen(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "hermes-pruefer",
  };
}

export function mitSeite(pfad, seite) {
  const trenner = pfad.includes("?") ? "&" : "?";
  return `${pfad}${trenner}per_page=${PRO_SEITE}&page=${seite}`;
}

export function githubZugang({
  abruf = fetch,
  token = env.GH_TOKEN || env.GITHUB_TOKEN,
  api,
  repo,
} = {}) {
  const adresse = api ?? (env.GITHUB_API_URL || GITHUB_API);
  const name = repo ?? (env.GITHUB_REPOSITORY || STANDARD_REPO);
  async function anfrage(methode, pfad, daten) {
    if (!token) throw new Error("GH_TOKEN oder GITHUB_TOKEN fehlt");
    const body = daten === undefined ? undefined : JSON.stringify(daten);
    const antwort = await abruf(`${adresse}/repos/${name}${pfad}`, {
      method: methode,
      headers: kopfzeilen(token),
      body,
    });
    if (!antwort.ok)
      throw new Error(`die GitHub-API antwortet auf ${methode} ${pfad} mit HTTP ${antwort.status}`);
    return antwort;
  }
  const hole = async (pfad) => (await anfrage("GET", pfad)).json();
  async function alle(pfad, liste) {
    const eintraege = [];
    for (let seite = 1; ; seite += 1) {
      const stapel = liste(await hole(mitSeite(pfad, seite))) ?? [];
      eintraege.push(...stapel);
      if (stapel.length < PRO_SEITE) return eintraege;
    }
  }
  return {
    repo: name,
    hole,
    alle,
    roh: async (pfad) => Buffer.from(await (await anfrage("GET", pfad)).arrayBuffer()),
    sende: async (methode, pfad, daten) => (await anfrage(methode, pfad, daten)).json(),
  };
}
