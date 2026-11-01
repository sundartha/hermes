import { approvedAtHead, getJson, repositoryName } from "../testschutz/github.mjs";

export const VERTRAULICH_LABEL = "ueber-lauf-vertraulich";
const SETZER = "sundartha-agent[bot]";
const SETZER_TYP = "Bot";
const FREIGEBER = ["Antonio20045"];
const LABEL_EREIGNISSE = ["labeled", "unlabeled"];
const PRO_SEITE = 100;
const MAX_SEITEN = 10;
const KURZ = 8;

async function alle(pfad) {
  const treffer = [];
  for (let seite = 1; seite <= MAX_SEITEN; seite += 1) {
    const teil = await getJson(`${pfad}?per_page=${PRO_SEITE}&page=${seite}`);
    treffer.push(...teil);
    if (teil.length < PRO_SEITE) return treffer;
  }
  throw new Error(`mehr als ${MAX_SEITEN * PRO_SEITE} Einträge unter ${pfad}`);
}

function letztesLabelEreignis(ereignisse) {
  return ereignisse.filter((ereignis) => LABEL_EREIGNISSE.includes(ereignis.event) && ereignis.label?.name === VERTRAULICH_LABEL).at(-1);
}

function setzerProblem(ereignis) {
  if (ereignis?.event !== "labeled") return `die Timeline zeigt nicht, dass das Label ${VERTRAULICH_LABEL} zuletzt gesetzt wurde`;
  if (ereignis.actor?.login === SETZER && ereignis.actor?.type === SETZER_TYP) return undefined;
  return `das Label ${VERTRAULICH_LABEL} hat ${ereignis.actor?.login ?? "ein unbekanntes Konto"} gesetzt; es zählt nur, wenn ${SETZER} es setzt`;
}

function labelProblem(pull, ereignisse) {
  if (!pull.labels?.some(({ name }) => name === VERTRAULICH_LABEL)) return `das Label ${VERTRAULICH_LABEL} fehlt am PR`;
  return setzerProblem(letztesLabelEreignis(ereignisse));
}

function freigabeProblem(reviews, kopf) {
  if (typeof kopf !== "string" || kopf === "") return "der aktuelle Kopf des PR ist nicht lesbar";
  if (approvedAtHead(reviews, FREIGEBER, kopf).length > 0) return undefined;
  return `kein Approve von ${FREIGEBER.join(" oder ")} am aktuellen Kopf ${kopf.slice(0, KURZ)}`;
}

export async function vertraulichProblem(nummer) {
  try {
    const pfad = `/repos/${repositoryName().full}`;
    const pull = await getJson(`${pfad}/pulls/${nummer}`);
    const label = labelProblem(pull, await alle(`${pfad}/issues/${nummer}/events`));
    return label ?? freigabeProblem(await alle(`${pfad}/pulls/${nummer}/reviews`), pull.head?.sha);
  } catch (fehler) {
    return `die Timeline oder die Reviews des PR sind nicht lesbar (${fehler.message})`;
  }
}
