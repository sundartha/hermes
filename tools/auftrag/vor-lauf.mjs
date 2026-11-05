import { existsSync } from "node:fs";
import { join } from "node:path";

import { REGELDATEI } from "../abhaengigkeiten/regeldatei.mjs";
import { bereiche, ordnungsBefunde } from "../abhaengigkeiten/testordnung.mjs";

import { jsZwillingDes, reihenfolge } from "./format.mjs";
import { festwertTestBefunde } from "./festwert-hinweis.mjs";
import { gebauteAuftraege, imGitRepo } from "./git.mjs";

const TEST_ORDNER = "test/";

function vorhanden(root, pfad) {
  return existsSync(join(root, pfad));
}

function neueTestpfade(auftrag, root) {
  const pfade = new Set([auftrag.abnahme, ...auftrag.erwarteteDateien].filter((pfad) => pfad.startsWith(TEST_ORDNER)));
  return [...pfade].filter((pfad) => {
    const zwilling = jsZwillingDes(pfad);
    return !vorhanden(root, pfad) && (zwilling === undefined || !vorhanden(root, zwilling));
  });
}

function testordnungBefunde(auftraege, root) {
  if (!vorhanden(root, REGELDATEI)) return [];
  const erlaubt = bereiche(root);
  return auftraege.flatMap((auftrag) => ordnungsBefunde(neueTestpfade(auftrag, root), erlaubt).map((befund) => `${auftrag.id}: ${befund}`));
}

export function vorLaufBefunde(phase, root) {
  const mitGit = imGitRepo(root);
  const fertig = mitGit ? gebauteAuftraege(phase, root) : new Set();
  const auftraege = reihenfolge(phase.auftraege).ordnung.filter(({ id }) => !fertig.has(id));
  const festwert = festwertTestBefunde({ ...phase, auftraege }, root);
  return { befunde: [...testordnungBefunde(auftraege, root), ...festwert.befunde], hinweise: festwert.hinweise };
}
