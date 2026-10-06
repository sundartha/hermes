import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";
import {
  BLOCKIERT,
  SAUBER,
  WEITER,
  ergebnisVon,
  laufAdresse,
  schreibeJson,
  setzeAusgaben,
} from "./ausgabe.mjs";
import { IDS, befund } from "./befunde.mjs";
import { istGruen, laeuft, letzterBearbeitenderLauf, letzterCiLauf, nimmGithubZugang } from "./github.mjs";
import { eigenePrs, roterLauf, schliesseRotenPr } from "./prs.mjs";

export const WORKFLOW = "aufraeumen.yml";
const ARBEITSSCHRITT = "Ziel wählen";
export const ORDNER = "ziel";
export const DATEI = "vorpruefung.json";

export function masterSha(root) {
  return gitAusgabe(["rev-parse", "HEAD"], root).trim();
}

export async function unveraendert(github, sha) {
  const letzter = await letzterBearbeitenderLauf(github, { workflow: WORKFLOW, schritt: ARBEITSSCHRITT });
  return letzter?.head_sha === sha ? letzter : null;
}

async function eigeneOffene(github, lauf) {
  const befunde = [];
  const offen = await eigenePrs(github, "open");
  for (const pr of offen) {
    const roter = await roterLauf(github, pr);
    if (roter === null) continue;
    await schliesseRotenPr(github, pr, { lauf, roter });
    const text = `Der eigene PR #${pr.nummer} war rot (${roter.html_url ?? roter.conclusion}) und ist geschlossen.`;
    befunde.push({ ...befund(IDS.prRot, pr.datei, text), pr: pr.nummer });
  }
  return { offen, befunde };
}

async function masterLage(github) {
  const ci = await letzterCiLauf(github);
  if (ci === null) return "kein CI-Lauf auf master gefunden";
  if (laeuft(ci)) return `CI auf master läuft noch (${ci.html_url ?? ""})`;
  return istGruen(ci) ? null : `der letzte CI-Lauf auf master endete mit ${ci.conclusion}`;
}

export async function vorpruefe({ github, root }) {
  const sha = masterSha(root);
  const { offen, befunde } = await eigeneOffene(github, laufAdresse());
  const basis = { master: sha, start: new Date().toISOString(), befunde };
  if (befunde.length > 0) {
    const nummern = befunde.map(({ pr }) => `#${pr}`).join(", ");
    return { ...ergebnisVon(BLOCKIERT, `eigener PR ${nummern} war rot und ist geschlossen`), ...basis };
  }
  if (offen.length > 0) {
    return { ...ergebnisVon(BLOCKIERT, `eigener PR #${offen[0].nummer} ist noch offen`), ...basis };
  }
  const letzter = await unveraendert(github, sha);
  if (letzter) return { ...ergebnisVon(SAUBER, `master unverändert seit ${letzter.html_url ?? letzter.id}`), ...basis };
  const grund = await masterLage(github);
  return { ...ergebnisVon(grund ? BLOCKIERT : WEITER, grund ?? ""), ...basis };
}

export async function befehl({ ordner }, root, { github = nimmGithubZugang() } = {}) {
  const ergebnis = await vorpruefe({ github, root });
  schreibeJson(`${ordner}/${ORDNER}`, DATEI, ergebnis);
  setzeAusgaben({ ausgang: ergebnis.ausgang, grund: ergebnis.grund });
  console.log(`Vorprüfung: ${ergebnis.ausgang}${ergebnis.grund ? ` (${ergebnis.grund})` : ""}`);
  return 0;
}
