import { githubZugang } from "./pruefer-github.mjs";

export const SYSTEM_LABEL = "system";
const AELTESTE_ZUERST = `/issues?state=open&labels=${SYSTEM_LABEL}&sort=created&direction=asc`;

export async function aeltestesSystemIssue(github) {
  const offen = await github.alle(AELTESTE_ZUERST, (liste) => liste);
  const issues = offen.filter((eintrag) => eintrag.pull_request === undefined && eintrag.state === "open");
  issues.sort((links, rechts) => Date.parse(links.created_at) - Date.parse(rechts.created_at));
  return issues[0] ?? null;
}

export async function system({ github = githubZugang() } = {}) {
  const issue = await aeltestesSystemIssue(github);
  if (issue === null) {
    console.log("kein offenes system-Issue");
    return 0;
  }
  console.log(`#${issue.number} ${issue.title}`);
  console.log(issue.html_url);
  return 0;
}
