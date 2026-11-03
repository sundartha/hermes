import { writeFileSync } from "node:fs";
import { env } from "node:process";

import { APPROVERS } from "../akteure.mjs";
import { releaseSections } from "../freigabe-markdown.mjs";
import { prNummer } from "../src-nur-lauf/nummer.mjs";
import { getJson, graphql, linkedIssues, repositoryName } from "../testschutz/github.mjs";

const LISTENPUNKT = /^[-*+]\s+/;
const ZEILENUMBRUCH = /\r?\n/;
const JSON_INDENT = 2;
const KOMMENTARE = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      comments(first: 100) {
        pageInfo { hasNextPage }
        nodes { author { login } body lastEditedAt userContentEdits { totalCount } }
      }
    }
  }
}`;

function ohneListenpunkt(zeile) {
  return zeile.trim().replace(LISTENPUNKT, "");
}

function unbearbeitetVonApprover(kommentar) {
  const ungeaendert = kommentar.lastEditedAt === null && kommentar.userContentEdits?.totalCount === 0;
  return ungeaendert && APPROVERS.includes(kommentar.author?.login) && typeof kommentar.body === "string";
}

function belegteZeilen(kommentare) {
  if (kommentare?.pageInfo?.hasNextPage !== false || !Array.isArray(kommentare.nodes)) return new Set();
  return new Set(kommentare.nodes.filter(unbearbeitetVonApprover).flatMap(({ body }) => body.split(ZEILENUMBRUCH).map(ohneListenpunkt)));
}

export function freigabenAus(issues) {
  const freigaben = new Map();
  for (const issue of issues) {
    const belegt = belegteZeilen(issue.kommentare);
    for (const zeile of releaseSections(issue.body).flat().map(ohneListenpunkt)) {
      if (belegt.has(zeile)) freigaben.set(zeile, issue.number);
    }
  }
  return freigaben;
}

async function mitKommentaren(issue) {
  const { issue: gelesen } = await graphql(KOMMENTARE, issue.number);
  return { ...issue, kommentare: gelesen?.comments };
}

async function verknuepfteIssues(nummer) {
  const pull = await getJson(`/repos/${repositoryName().full}/pulls/${nummer}`);
  return Promise.all((await linkedIssues(pull.body)).map(mitKommentaren));
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
