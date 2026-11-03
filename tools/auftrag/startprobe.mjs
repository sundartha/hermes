import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { EXIT_GRUEN, EXIT_ROT } from "./befehle.mjs";
import { imBereich, ladePhase } from "./format.mjs";
import { NUL, gebauteAuftraege, git } from "./git.mjs";
import { testsJeDatei } from "./testumbau.mjs";

function offeneAuftraege(phase, root) {
  const fertig = gebauteAuftraege(phase, root);
  return phase.auftraege.filter(({ id }) => !fertig.has(id));
}

function bereichsDateien(auftraege, root) {
  const dateien = git(["ls-files", "-z"], { cwd: root }).split(NUL).filter(Boolean);
  return dateien.filter((pfad) => auftraege.some(({ bereich }) => imBereich(bereich, pfad)));
}

function vorhandeneAbnahmen(auftraege, root) {
  return auftraege.map(({ abnahme }) => abnahme).filter((pfad) => typeof pfad === "string" && existsSync(join(root, pfad)));
}

async function testsImBereich(phasendatei, root) {
  const auftraege = offeneAuftraege(ladePhase(phasendatei), root);
  const erreicht = [...(await testsJeDatei(bereichsDateien(auftraege, root), root)).values()].flat();
  return [...new Set([...erreicht, ...vorhandeneAbnahmen(auftraege, root)])].sort();
}

export async function startprobe(phasendatei, root) {
  const tests = await testsImBereich(phasendatei, root);
  if (tests.length === 0) {
    console.log("Vorlauf: Kein Test erreicht den Bereich der offenen Aufträge; nichts zu prüfen.");
    return EXIT_GRUEN;
  }
  console.log(`Vorlauf: ${tests.length} Testdateien im Bereich laufen auf dem festen Stand: ${tests.join(", ")}`);
  const lauf = spawnSync("npm", ["--silent", "test", "--", ...tests], { cwd: root, env, stdio: "inherit" });
  return lauf.status ?? EXIT_ROT;
}
