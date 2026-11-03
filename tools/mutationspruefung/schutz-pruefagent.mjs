import { writeFileSync } from "node:fs";
import { env } from "node:process";

import { APPROVERS } from "../akteure.mjs";
import { releaseSections } from "../freigabe-markdown.mjs";
import { prNummer } from "../src-nur-lauf/nummer.mjs";
import { getJson, linkedIssues, repositoryName } from "../testschutz/github.mjs";

const LISTENPUNKT = /^[-*+]\s+/;
const JSON_INDENT = 2;

function vertrauenswuerdig({ author, editor }) {
  const bearbeiter = editor?.login === undefined ? [] : [editor.login];
  return [author?.login, ...bearbeiter].every((login) => APPROVERS.includes(login));
}

export function freigabenAus(issues) {
  const freigaben = new Map();
  for (const issue of issues.filter(vertrauenswuerdig)) {
    for (const zeile of releaseSections(issue.body).flat()) freigaben.set(zeile.replace(LISTENPUNKT, ""), issue.number);
  }
  return freigaben;
}

async function verknuepfteIssues(nummer) {
  const pull = await getJson(`/repos/${repositoryName().full}/pulls/${nummer}`);
  return linkedIssues(pull.body);
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
