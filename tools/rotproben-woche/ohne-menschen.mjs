import { PER_PAGE, repo, repoPages } from "../wochenbericht/github.mjs";
import { gruen, rot } from "./bericht.mjs";

const PRUEFER = new Set(["Antonio20045", "jonas986"]);
const ARTEN = new Set(["art:code", "art:strenger"]);
const TAGE = 7;
const MS_JE_TAG = 86_400_000;
const RAHMEN = `in ${TAGE} Tagen gemergt, Label art:code oder art:strenger`;
const KOPF = `In ${TAGE} Tagen gemergte PRs mit Label art:code oder art:strenger`;

async function freigabeVorMerge({ number, merged_at: gemergtAm }) {
  const reviews = await repo(`/pulls/${number}/reviews?per_page=${PER_PAGE}`);
  const merge = Date.parse(gemergtAm);
  const freigabe = reviews.find(
    ({ user, state, submitted_at: abgegeben }) =>
      state === "APPROVED" && PRUEFER.has(user?.login) && Date.parse(abgegeben) < merge,
  );
  return freigabe?.user.login;
}

function imFenster(grenze) {
  return ({ merged_at: gemergtAm, labels }) =>
    Boolean(gemergtAm) &&
    Date.parse(gemergtAm) >= grenze &&
    labels.some(({ name }) => ARTEN.has(name));
}

export async function ohneMenschen() {
  const grenze = Date.now() - TAGE * MS_JE_TAG;
  const zuletzt = await repoPages("/pulls?state=closed&sort=updated&direction=desc", {
    until: ({ updated_at: geaendert }) => Date.parse(geaendert) < grenze,
  });
  const gemergt = zuletzt.filter(imFenster(grenze));
  if (gemergt.length === 0) return gruen(`keine solchen PRs (${RAHMEN}).`);
  const mitFreigabe = [];
  for (const pull of gemergt) {
    const von = await freigabeVorMerge(pull);
    if (von) mitFreigabe.push(`#${pull.number} (${von})`);
  }
  const liste = gemergt.map(({ number }) => `#${number}`).join(", ");
  const kopf = `${KOPF}: ${gemergt.length} (${liste}).`;
  if (mitFreigabe.length === 0) {
    return gruen(`${kopf} Keiner hat ein Approve von Antonio20045 oder jonas986 vor dem Merge.`);
  }
  return rot(`${kopf} Mit Approve vor dem Merge: ${mitFreigabe.join(", ")}.`);
}
