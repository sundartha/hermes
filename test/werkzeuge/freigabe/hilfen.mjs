import { join } from "node:path";

import { REPO_ROOT, runIn } from "../probe-repo.js";
import { scheinGithub } from "../pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug } from "../warteschlange/hilfen.mjs";

const FREIGABE = join(REPO_ROOT, "tools/freigabe-pruefung.mjs");
const PR = 7;
const OHNE_NETZ = "http://127.0.0.1:9";

export async function freigabeImProbeRepo(context, { verzeichnis, basis, reviews = () => [] }) {
  const kopf = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const github = await scheinGithub(
    context,
    new Map([
      [`GET ${API_PFAD}/pulls/${PR}`, { number: PR, head: { sha: kopf }, labels: [] }],
      [`GET ${API_PFAD}/pulls/${PR}/reviews`, reviews(kopf)],
      [`GET ${API_PFAD}/issues/${PR}/comments`, []],
      [`POST ${API_PFAD}/issues/${PR}/comments`, {}],
      [`POST ${API_PFAD}/issues/${PR}/labels`, {}],
    ]),
  );
  const args = [
    "--basis",
    basis,
    "--pr",
    String(PR),
    "--registry",
    OHNE_NETZ,
    "--downloads",
    OHNE_NETZ,
  ];
  const lauf = await starteWerkzeug([FREIGABE, ...args], {
    cwd: verzeichnis,
    umgebung: { GITHUB_API_URL: github.url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO },
  });
  return { ...lauf, anfragen: github.anfragen };
}
