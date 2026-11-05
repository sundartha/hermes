import { test } from "node:test";
import { join } from "node:path";

import { NEGATIV, NULL, BASIS, pruefe, quelle } from "./mutationspruefung-hilfen.js";
import { probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";

const FENSTER = 190;
const lauf = (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  return pruefe(repo, "--basis", "HEAD", "--plan", join(probeDirectory(context, {}), "plan.json"));
};

for (const index of [0, 1, 2, 3, 4]) {
  test(`DIAG stderr ${index}`, (context) => {
    const ergebnis = lauf(context);
    if (ergebnis.status === 0) return;
    throw new Error(`DIAG${index} ${JSON.stringify(ergebnis.stderr.slice(index * FENSTER, (index + 1) * FENSTER))}`);
  });
}
