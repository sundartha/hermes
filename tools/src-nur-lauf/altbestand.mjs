import { altbestandListe } from "../auftrag/altbestand.mjs";
import { git } from "../auftrag/git.mjs";
import { patchIdVon } from "../auftrag/pruefer-auswahl.mjs";
import { getJson } from "../testschutz/github.mjs";
import { alle, freigabeProblem, repoPfad } from "./freigabe.mjs";

const WARTET = "Altbestand: wartet auf Antonios Approve am Kopf";
const NICHT_PRUEFBAR = "Altbestand: Zuordnung des Commits zum PR nicht prüfbar";
const MERGE_GRUPPE = "merge_group";

async function freigabeAmKopf(nummer) {
  try {
    const pfad = repoPfad();
    const kopf = (await getJson(`${pfad}/pulls/${nummer}`)).head?.sha;
    return { kopf, problem: freigabeProblem(await alle(`${pfad}/pulls/${nummer}/reviews`), kopf) };
  } catch (fehler) {
    return { problem: `Pull Request oder Reviews nicht lesbar (${fehler.message})` };
  }
}

function patchIdsDesPullRequests({ nummer, kopf, basis, root }) {
  git(["fetch", "--no-tags", "--quiet", "origin", `refs/pull/${nummer}/head`], { cwd: root });
  if (git(["rev-parse", "FETCH_HEAD^{commit}"], { cwd: root }).trim() !== kopf) throw new Error("der Kopf des PR hat sich beim Abruf geändert");
  const shas = git(["rev-list", "--no-merges", kopf, "--not", basis], { cwd: root }).split("\n").filter(Boolean);
  return new Set(shas.map((sha) => patchIdVon(sha, root)).filter(Boolean));
}

export function altbestandPruefer({ ereignis, nummer, basis, kopf }, root) {
  const { wirksam, probleme } = altbestandListe(basis, kopf, root);
  const key = String(nummer);
  let urteil;
  let ids;
  return {
    probleme,
    async gruende(sha) {
      if (!wirksam.has(key)) return null;
      urteil ??= await freigabeAmKopf(key);
      if (urteil.problem !== undefined) return [`${WARTET} (${urteil.problem})`];
      if (ereignis !== MERGE_GRUPPE) return [];
      try {
        ids ??= patchIdsDesPullRequests({ nummer: key, kopf: urteil.kopf, basis, root });
        return ids.has(patchIdVon(sha, root)) ? [] : null;
      } catch (fehler) {
        return [`${NICHT_PRUEFBAR} (${fehler.message})`];
      }
    },
  };
}
