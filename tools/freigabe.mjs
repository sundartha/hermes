import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPROVERS, alleSeiten, api, ereignis, geaenderteDateien } from "./github.mjs";

const BAU_AGENT = "sundartha-agent[bot]";
const PRODUKTCODE = "src/";
const FREIGEGEBEN = "APPROVED";
const KURZ = 7;
const EXIT_ROT = 1;

function letzteUrteile(reviews) {
  const jeAutor = new Map();
  for (const review of reviews) {
    if (APPROVERS.includes(review.user?.login) && review.state !== "COMMENTED") jeAutor.set(review.user.login, review);
  }
  return [...jeAutor.values()];
}

export function freigabeBefunde(pull, reviews, dateien) {
  const kopf = pull.head.sha;
  const ergebnis = [];
  const aendertSrc = dateien.some(({ pfad }) => pfad.startsWith(PRODUKTCODE));
  if (aendertSrc && pull.user?.login !== BAU_AGENT) {
    ergebnis.push(`Code unter ${PRODUKTCODE} kommt nur vom Bau-Agenten (${BAU_AGENT}); dieser PR ist von ${pull.user?.login}.`);
  }
  const freigaben = letzteUrteile(reviews).filter(({ state, commit_id: stand }) => state === FREIGEGEBEN && stand === kopf);
  if (freigaben.length === 0) {
    ergebnis.push(`Es fehlt das KI-Urteil: ein Approve von ${APPROVERS.join(" oder ")} auf dem Stand ${kopf.slice(0, KURZ)}.`);
  } else {
    console.log(`Freigegeben von ${freigaben.map(({ user }) => user.login).join(" und ")} auf ${kopf.slice(0, KURZ)}.`);
  }
  return ergebnis;
}

async function main() {
  const { pr, basis, kopf } = ereignis();
  const pull = await api(`/pulls/${pr}`);
  const reviews = await alleSeiten(`/pulls/${pr}/reviews`);
  const gefunden = freigabeBefunde(pull, reviews, geaenderteDateien(basis, kopf));
  for (const zeile of gefunden) console.log(zeile);
  if (gefunden.length > 0) process.exitCode = EXIT_ROT;
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
