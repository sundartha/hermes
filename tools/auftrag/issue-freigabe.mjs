import { spawnSync } from "node:child_process";
import { env } from "node:process";

import { ISSUE_QUERY, issueApproval, listHint } from "../testschutz/freigabe.mjs";

export function phasenIssue(nummer, root) {
  const befehl = ["api", "graphql", "-f", `query=${ISSUE_QUERY}`, "-F", "owner={owner}", "-F", "name={repo}", "-F", `number=${nummer}`];
  const antwort = spawnSync(env.HERMES_GH ?? "gh", befehl, { cwd: root, encoding: "utf8", env });
  try {
    const { data } = JSON.parse(antwort.stdout);
    return data.repository.issue ?? null;
  } catch {
    return null;
  }
}

export function freigabeProblem(issue, datei) {
  if (issue === null) return "gh lieferte kein lesbares Issue";
  const { problem, names } = issueApproval(issue);
  if (problem !== undefined) return problem;
  return names.includes(datei) ? null : `${datei} steht nicht als eigener Listenpunkt ${listHint()}`;
}
