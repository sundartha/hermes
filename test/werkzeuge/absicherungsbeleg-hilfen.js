import { chmodSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { env } from "node:process";

import { pruefsumme } from "../../tools/auftrag/absicherungsbeleg.mjs";
import { probeDirectory } from "./probe-repo.js";

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
  const gueltig = { version: 1, commit: basis, urteil: 0, bloecke, ...beleg };
  const werkzeug = probeDirectory(context, { gh: GH_ATTRAPPE, "lauf.json": JSON.stringify(lauffaehig), "beleg.json": JSON.stringify(gueltig) });
  chmodSync(join(werkzeug, "gh"), AUSFUEHRBAR);
  if (ohneBeleg) rmSync(join(werkzeug, "beleg.json"));
  sichere(context, "PATH", `${werkzeug}${delimiter}${env.PATH}`);
  sichere(context, "GH_LAUF", join(werkzeug, "lauf.json"));
  sichere(context, "GH_BELEG", join(werkzeug, "beleg.json"));
  sichere(context, "GITHUB_REPOSITORY", REPO);
}
