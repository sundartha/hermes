const FOLGEJOB = "CI";
const GESCHEITERT = "failure";
const UNGEPRUEFT_OK = new Set(["success", "skipped", "neutral"]);
const VOM_RUNNER = new Set(["Set up job", "Complete job"]);
const NACH_SCHRITT = "Post ";
export const SCHRITTE_IM_WORKFLOW = new Set([
  "Checkout",
  "Node 22",
  "npm ci",
  "Node 22, npm ci und Install-Skripte",
  "Vorgaben laden",
  "Vorgaben hochladen",
  "Teilergebnisse laden",
  "Teilergebnis hochladen",
  "Zeit-Log hochladen",
  "Mutationsurteil hochladen",
]);

function ausserhalbDerPruefung(name) {
  return VOM_RUNNER.has(name) || SCHRITTE_IM_WORKFLOW.has(name) || (name.startsWith(NACH_SCHRITT) && name.length > NACH_SCHRITT.length);
}

function nurAusserhalbDerPruefung(job) {
  const gescheiterte = (job.steps ?? []).filter((schritt) => schritt.conclusion === GESCHEITERT);
  return gescheiterte.length > 0 && gescheiterte.every((schritt) => ausserhalbDerPruefung(schritt.name));
}

export function nurInfrastrukturGescheitert(jobs) {
  const gescheitert = jobs.filter((job) => job.conclusion === GESCHEITERT && job.name !== FOLGEJOB);
  const fremd = jobs.some((job) => job.conclusion !== GESCHEITERT && !UNGEPRUEFT_OK.has(job.conclusion));
  return !fremd && gescheitert.length > 0 && gescheitert.every(nurAusserhalbDerPruefung);
}
