import assert from "node:assert/strict";
import { join } from "node:path";

import { listenUmziehen } from "../../tools/auftrag/listenumzug.mjs";

import { REPO_ROOT, commitAll, runIn, writeFiles } from "./probe-repo.js";

export const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const EXIT_GRUEN = 0;

export function auslagernMit(repo, dateien) {
  writeFiles(repo, dateien);
  commitAll(repo, "Auslagerung");
}

export async function umziehen(context, repo) {
  const meldungen = [];
  context.mock.method(console, "log", (zeile) => meldungen.push(zeile));
  const ergebnis = await listenUmziehen({ basis: "HEAD~1", root: repo });
  assert.equal(ergebnis, EXIT_GRUEN, meldungen.join("\n"));
  return meldungen.join("\n");
}

export function gateFuer(repo, werkzeug) {
  const lauf = runIn(repo, process.execPath, [BASIS_VERGLEICH, werkzeug, "--basis", "HEAD~1"]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}
