import { env } from "node:process";

import { ausloesenderLauf, stammtAus } from "../auftrag/pruefer-herkunft.mjs";
import { bereichAusBranch } from "./pfade.mjs";

export const EINGANG = { datei: "ausmisten-eingang.yml", ereignis: "push" };
export const MESSUNG = { datei: "tests-ausmisten.yml", ereignis: "workflow_run" };
export const KONTEXT = "Tests ausmisten";
export const SHA = /^[0-9a-f]{40}$/;
export const ERFOLG = "success";
const WORKFLOW_ORDNER = ".github/workflows/";
const REF_TRENNER = "@";

export function laufTitel(kopf, branch) {
  return `${KONTEXT} ${kopf} ${branch}`;
}

export function pfadUndEreignis(lauf, herkunft) {
  const pfad = String(lauf?.path ?? "").split(REF_TRENNER)[0];
  return pfad === `${WORKFLOW_ORDNER}${herkunft.datei}` && lauf.event === herkunft.ereignis;
}

export function gleichesRepo(kopfRepo, repo) {
  const name = env.GITHUB_REPOSITORY ?? "";
  if (name === "" || kopfRepo?.full_name !== name || repo?.full_name !== name) return false;
  return Number.isInteger(repo.id) && kopfRepo.id === repo.id;
}

function nutzdatenFehler(lauf) {
  if (lauf === null) return "kein auslösender Lauf im Ereignis";
  if (!pfadUndEreignis(lauf, EINGANG))
    return "der auslösende Lauf ist kein Push-Lauf von ausmisten-eingang.yml";
  if (lauf.conclusion !== ERFOLG) return "der auslösende Lauf ist nicht erfolgreich";
  if (!gleichesRepo(lauf.head_repository, lauf.repository)) {
    return "der Branch liegt nicht in diesem Repository";
  }
  if (!SHA.test(lauf.head_sha ?? "")) return "die Kopf-SHA ist ungültig";
  return undefined;
}

export async function ausloeser({ bereiche, github }) {
  const lauf = ausloesenderLauf();
  const fehler = nutzdatenFehler(lauf);
  if (fehler) throw new Error(`Herkunft: ${fehler}.`);
  const eintrag = bereichAusBranch(lauf.head_branch, bereiche);
  if (eintrag === undefined) {
    throw new Error(`Herkunft: der Branch heißt nicht genau ausmisten/<Bereich mit Quellen>.`);
  }
  if (github !== undefined && !(await stammtAus(github, lauf, EINGANG))) {
    throw new Error("Herkunft: die Workflow-Nummer gehört nicht zu ausmisten-eingang.yml.");
  }
  return { kopf: lauf.head_sha, branch: lauf.head_branch, bereich: eintrag.bereich };
}
