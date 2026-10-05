import { readFileSync } from "node:fs";
import { env } from "node:process";

export const CI_LAUF = { datei: "ci.yml", ereignis: "pull_request" };
export const PRUEFER_LAUF = { datei: "pruefer-pruefen.yml", ereignis: "workflow_run" };
const WORKFLOW_ORDNER = ".github/workflows/";
const REF_TRENNER = "@";

export function ausloesenderLauf() {
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8")).workflow_run ?? null;
  } catch {
    return null;
  }
}

function pfadDer(herkunft) {
  return `${WORKFLOW_ORDNER}${herkunft.datei}`;
}

export async function workflowNummer(github, herkunft) {
  const { id } = await github.hole(`/actions/workflows/${herkunft.datei}`);
  return id;
}

function pfadUndEreignisPassen(lauf, herkunft) {
  const pfad = String(lauf?.path ?? "").split(REF_TRENNER)[0];
  return pfad === pfadDer(herkunft) && lauf.event === herkunft.ereignis;
}

export function passtZu(lauf, herkunft, nummer) {
  return pfadUndEreignisPassen(lauf, herkunft) && lauf.workflow_id === nummer;
}

export async function stammtAus(github, lauf, herkunft) {
  if (!pfadUndEreignisPassen(lauf, herkunft)) return false;
  return lauf.workflow_id === (await workflowNummer(github, herkunft));
}
