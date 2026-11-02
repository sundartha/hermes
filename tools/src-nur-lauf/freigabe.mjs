import { approvedAtHead, getJson, repositoryName } from "../testschutz/github.mjs";

const FREIGEBER = ["Antonio20045"];
const PRO_SEITE = 100;
const MAX_SEITEN = 10;
const KURZ = 8;

export function repoPfad() {
  return `/repos/${repositoryName().full}`;
}

export async function alle(pfad) {
  const treffer = [];
  for (let seite = 1; seite <= MAX_SEITEN; seite += 1) {
    const teil = await getJson(`${pfad}?per_page=${PRO_SEITE}&page=${seite}`);
    treffer.push(...teil);
    if (teil.length < PRO_SEITE) return treffer;
  }
  throw new Error(`mehr als ${MAX_SEITEN * PRO_SEITE} Einträge unter ${pfad}`);
}

export function freigabeProblem(reviews, kopf) {
  if (typeof kopf !== "string" || kopf === "") return "der aktuelle Kopf des PR ist nicht lesbar";
  if (approvedAtHead(reviews, FREIGEBER, kopf).length > 0) return undefined;
  return `kein Approve von ${FREIGEBER.join(" oder ")} am aktuellen Kopf ${kopf.slice(0, KURZ)}`;
}
