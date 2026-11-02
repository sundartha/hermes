import { spawnSync } from "node:child_process";
import { env } from "node:process";

import { workflowStepScript } from "./workflow-dateien.js";

const CI_WORKFLOW = "ci.yml";
const COLLECTING_STEP = "Alle Jobs erfolgreich";

export function sammeljob(ereignis, ergebnisse) {
  const needs = Object.fromEntries(Object.entries(ergebnisse).map(([job, result]) => [job, { result }]));
  const umgebung = { ...env, NEEDS: JSON.stringify(needs), EREIGNIS: ereignis };
  const lauf = spawnSync("bash", ["-c", workflowStepScript(CI_WORKFLOW, COLLECTING_STEP)], { encoding: "utf8", env: umgebung });
  return { status: lauf.status, meldung: lauf.stdout + lauf.stderr };
}
