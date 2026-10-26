import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { cwd } from "node:process";

const REMOTE = "upstream";
const ADRESSE = "https://github.com/sundartha/hermes";

function git(argumente) {
  const lauf = spawnSync("git", argumente, { encoding: "utf8" });
  return { ok: lauf.status === 0, ausgabe: `${lauf.stdout ?? ""}${lauf.stderr ?? ""}`.trim() };
}

function istRepoWurzel() {
  const wurzel = git(["rev-parse", "--show-toplevel"]);
  return wurzel.ok && realpathSync(wurzel.ausgabe) === realpathSync(cwd());
}

function legeUpstreamAn() {
  if (!istRepoWurzel() || git(["remote", "get-url", REMOTE]).ok) return;
  const angelegt = git(["remote", "add", REMOTE, ADRESSE]);
  if (angelegt.ok) {
    console.log(`Remote ${REMOTE} angelegt (${ADRESSE}); die Basis holt git fetch ${REMOTE}.`);
    return;
  }
  console.error(`Remote ${REMOTE} ließ sich nicht anlegen: ${angelegt.ausgabe}`);
  console.error(`Von Hand: git remote add ${REMOTE} ${ADRESSE}`);
}

legeUpstreamAn();
