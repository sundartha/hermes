import { prNummerAus } from "../warteschlange/gleicher-stand.mjs";

const ZIFFERN = /^\d+$/;
const PULL_REQUEST = "pull_request";
const MERGE_GROUP = "merge_group";

function ausPullRequest(pr) {
  return ZIFFERN.test(pr ?? "") ? { nummer: pr } : { problem: "die PR-Nummer fehlt (--pr) im pull_request-Lauf; der Nachweis ist nicht prüfbar" };
}

function ausWarteschlange(ref) {
  const nummer = prNummerAus(ref);
  return nummer === null
    ? { problem: `die PR-Nummer lässt sich nicht aus dem Ref der Merge-Gruppe lesen (--queue-ref ${JSON.stringify(ref ?? "")}); erwartet ist …/pr-NUMMER-SHA` }
    : { nummer: String(nummer) };
}

export function prNummer({ ereignis, pr, "queue-ref": ref }) {
  if (ereignis === undefined) return { nummer: pr };
  if (ereignis === PULL_REQUEST) return ausPullRequest(pr);
  if (ereignis === MERGE_GROUP) return ausWarteschlange(ref);
  return { problem: `das Ereignis ${JSON.stringify(ereignis)} kennt der Schritt nicht` };
}
