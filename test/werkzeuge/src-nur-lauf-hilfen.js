import { join } from "node:path";

import { auftragsZettel } from "../../tools/auftrag/agenten.mjs";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

export const WERKZEUG = join(REPO_ROOT, "tools/src-nur-lauf.mjs");
export const PHASE = "P-probe";
export const PHASENDATEI = `plaene/${PHASE}/phase.json`;
export const EXIT_OK = 0;
export const EXIT_BEFUND = 1;
export const AUFTRAG = {
  id: "a1",
  art: "funktion",
  ziel: "Lege a.js an",
  bereich: "src/",
  erwarteteDateien: ["src/a.js", "test/a.test.js"],
  abnahme: "test/a.test.js",
  prueft: "a.js liefert eins",
  wasDarfNiePassieren: ["a.js liefert zwei."],
  abhaengigVon: [],
};
export const ZWEITER_AUFTRAG = { ...AUFTRAG, id: "a2", ziel: "Ändere a.js weiter" };
export const PLAN = { phase: PHASE, issue: 1, absicht: "a.js soll eins liefern.", entwurf: { "src/": "a.js liefert eins." }, auftraege: [AUFTRAG, ZWEITER_AUFTRAG] };
export const ANFANGSDATEIEN = { [PHASENDATEI]: `${JSON.stringify(PLAN, null, 2)}\n`, "src/a.js": "export const a = 0;\n" };
const PROBE_GIT = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

export function json(wert) {
  return `${JSON.stringify(wert, null, 2)}\n`;
}

export function nachricht(plan = PLAN, auftrag = AUFTRAG) {
  const zeilen = [auftrag.ziel, "", `Warum: Auftrag ${auftrag.id} der Phase ${plan.phase}.`, "", ...auftragsZettel(plan, auftrag)];
  return [...zeilen, `Auftrag: ${plan.phase}/${auftrag.id}`, `Art: ${auftrag.art}`, "Paket: PRB", ""].join("\n");
}

export function sha(verzeichnis) {
  return runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

export function gitIn(verzeichnis, ...argumente) {
  const lauf = runIn(verzeichnis, "git", [...PROBE_GIT, ...argumente]);
  if (lauf.status !== 0) throw new Error(`git ${argumente.join(" ")}: ${lauf.stderr}`);
  return lauf.stdout.trim();
}

export function aendereA(verzeichnis, text, zusatz = {}) {
  writeFiles(verzeichnis, { "src/a.js": `export const a = ${text.length};\n`, ...zusatz });
  commitAll(verzeichnis, text);
}

export function pruefe(verzeichnis, basis, zusatz = []) {
  return runIn(verzeichnis, process.execPath, [WERKZEUG, "--basis", basis, "--kopf", "HEAD", ...zusatz]);
}

export function imRepo(context, bauen) {
  const verzeichnis = probeRepository(context, ANFANGSDATEIEN);
  const basis = sha(verzeichnis);
  bauen(verzeichnis);
  return { lauf: pruefe(verzeichnis, basis), kopf: sha(verzeichnis), verzeichnis };
}
