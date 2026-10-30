import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { env } from "node:process";

import { pruefsumme, trailerZeile, vorabGeprueft } from "../../tools/auftrag/absicherungsbeleg.mjs";
import { probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
export const LAUF = "123";
const REPO = "eigner/repo";
const GH_ATTRAPPE = `#!/bin/sh
case "$1" in
  api) cat "$GH_LAUF" ;;
  run)
    while [ $# -gt 0 ]; do
      if [ "$1" = "-D" ]; then ziel="$2"; fi
      shift
    done
    if [ -f "$GH_BELEG" ]; then cp "$GH_BELEG" "$ziel/beleg.json"; fi
    ;;
esac
`;

function sichere(context, name, wert) {
  const vorher = env[name];
  env[name] = wert;
  context.after(() => {
    if (vorher === undefined) delete env[name];
    else env[name] = vorher;
  });
}

export function summen(zeilen) {
  return zeilen.map(pruefsumme);
}

export function legeGhAn(context, { basis, bloecke, lauf = {}, beleg = {}, ohneBeleg = false }) {
  const lauffaehig = { status: "completed", conclusion: "success", path: ".github/workflows/ci.yml", event: "workflow_dispatch", head_branch: "lauf-mutation/abc", repository: { full_name: REPO }, head_repository: { full_name: REPO }, head_sha: basis, ...lauf };
  const gueltig = { version: 1, commit: basis, urteil: 0, bloecke, dateien: Object.fromEntries(bloecke.map(({ datei, pruefsummen }) => [datei, pruefsummen])), ...beleg };
  const werkzeug = probeDirectory(context, { gh: GH_ATTRAPPE, "lauf.json": JSON.stringify(lauffaehig), "beleg.json": JSON.stringify(gueltig) });
  chmodSync(join(werkzeug, "gh"), AUSFUEHRBAR);
  if (ohneBeleg) rmSync(join(werkzeug, "beleg.json"));
  sichere(context, "PATH", `${werkzeug}${delimiter}${env.PATH}`);
  sichere(context, "GH_LAUF", join(werkzeug, "lauf.json"));
  sichere(context, "GH_BELEG", join(werkzeug, "beleg.json"));
  sichere(context, "GITHUB_REPOSITORY", REPO);
}

export const ZEILEN = Array.from({ length: 10 }, (leer, index) => `zeile${index + 1}`);
const QUELLE = `${ZEILEN.join("\n")}\n`;
const DATEIEN = {
  ".github/workflows/ci.yml": "name: CI\n",
  ".github/actions/node-npm-ci/action.yml": "name: Node\n",
  "package.json": "{}\n",
  "package-lock.json": "{}\n",
  "tools/mutationspruefung.mjs": "export const A = 1;\n",
  "tools/mutationspruefung/x.mjs": "export const B = 1;\n",
  "tools/auftrag/x.mjs": "export const C = 1;\n",
  "stryker.config.json": "{}\n",
  "test/a.test.js": "a\n",
  "src/m.js": QUELLE,
  "src/seltsam\tname.js": "alt\n",
};

export function aufbau(context, optionen = {}) {
  const { lauf, beleg, ohneBeleg, trailer, auftraege, quelle, geaendert } = { lauf: {}, beleg: {}, ohneBeleg: false, trailer: true, auftraege: ["A1"], quelle: ZEILEN, geaendert: null, ...optionen };
  const repo = probeRepository(context, { ...DATEIEN, "src/m.js": `${quelle.join("\n")}\n` });
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  runIn(repo, "git", ["update-ref", "refs/remotes/upstream/master", basis]);
  if (trailer) runIn(repo, "git", ["commit", "-q", "--allow-empty", "-m", `Testcommit\n\n${auftraege.map((id) => trailerZeile(LAUF, id)).join("\n")}`]);
  const neu = geaendert ?? [...quelle.slice(0, 2), ...quelle.slice(5)];
  writeFileSync(join(repo, "src/m.js"), `${neu.join("\n")}\n`);
  legeGhAn(context, { basis, bloecke: [{ datei: "src/m.js", von: 1, pruefsummen: summen(quelle.concat("")) }], lauf, beleg, ohneBeleg });
  return { repo, basis };
}

export function pruefe(context, optionen = {}, aenderung = () => {}) {
  const probe = aufbau(context, optionen);
  aenderung(probe.repo);
  return vorabGeprueft({ root: probe.repo, basis: probe.basis, auftragId: optionen.auftragId ?? "A1" });
}
