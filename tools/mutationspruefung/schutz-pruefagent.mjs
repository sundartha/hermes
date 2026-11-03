import { writeFileSync } from "node:fs";
import { env } from "node:process";

import { releaseSections } from "../freigabe-markdown.mjs";
import { prNummer } from "../src-nur-lauf/nummer.mjs";
import { closedIssueNumbers, graphql } from "../testschutz/github.mjs";

const LISTENPUNKT = /^[-*+]\s+/;
const ISSUE = "Issue";
const JSON_INDENT = 2;
const PR_TEXT = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { body } }
}`;
const ISSUE_TEXT = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { __typename ... on Issue { number body } } }
}`;

export function freigabenAus(issues) {
  const freigaben = new Map();
  for (const { number, body } of issues) {
    for (const zeile of releaseSections(body).flat()) freigaben.set(zeile.replace(LISTENPUNKT, ""), number);
  }
  return freigaben;
}

async function verknuepfteIssues(nummer) {
  const { pullRequest } = await graphql(PR_TEXT, Number(nummer));
  const knoten = await Promise.all(closedIssueNumbers(pullRequest?.body).map(async (issue) => (await graphql(ISSUE_TEXT, issue)).issueOrPullRequest));
  return knoten.filter((eintrag) => eintrag?.__typename === ISSUE);
}

export async function schutzfreigaben(umgebung = env) {
  const { nummer } = prNummer({ ereignis: umgebung.EVENT_NAME, pr: umgebung.PR_NUMBER, "queue-ref": umgebung.QUEUE_REF });
  if (!nummer) return { freigaben: new Map(), hinweise: ["Hinweis: keine PR-Nummer, Freigaben des Prüf-Agenten nicht gelesen."] };
  try {
    return { freigaben: freigabenAus(await verknuepfteIssues(nummer)), hinweise: [] };
  } catch (fehler) {
    return { freigaben: new Map(), hinweise: [`Hinweis: Freigaben des Prüf-Agenten nicht lesbar (${fehler.message}); es gilt keine Freigabe.`] };
  }
}

export function schreibeNichtPruefbar(eintraege, datei = env.NICHT_PRUEFBAR_DATEI) {
  if (!datei || eintraege.length === 0) return;
  writeFileSync(datei, `${JSON.stringify(eintraege, null, JSON_INDENT)}\n`);
}
