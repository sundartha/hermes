import { env } from "node:process";

import {
  ERFOLG,
  KONTEXT,
  MESSUNG,
  SHA,
  laufTitel,
  pfadUndEreignis,
} from "../tests-ausmisten/herkunft.mjs";
import { graphImStand, messmenge } from "../tests-ausmisten/messmenge.mjs";
import {
  BRANCH_PRAEFIX,
  bereichAusBranch,
  git,
  gitGelingt,
  leseBereiche,
  pfadVerstoesse,
  testaenderungen,
} from "../tests-ausmisten/pfade.mjs";
import { getJson, repositoryName } from "./github.mjs";

const MESSGRUNDLAGE = [
  "stryker.config.json",
  "package-lock.json",
  "package.json",
  "tools/bereiche.json",
  "tools/gate-tests.json",
];
const ZIELBRANCH = "master";
const ABGESCHLOSSEN = "completed";
const STANDARD_SERVER = "https://github.com";
const LAUF_NUMMER = /^(\d+)(?:\/attempts\/\d+)?$/;
const ELTERN_EINES_MERGES = 3;

function verlange(bedingung, grund) {
  if (!bedingung) throw new Error(grund);
}

function patchKennung(von, bis) {
  const diff = git(["diff", "--no-renames", "--no-color", "--no-ext-diff", "--binary", von, bis]);
  if (diff === "") return "";
  return git(["patch-id", "--stable"], undefined, diff).split(" ")[0];
}

function inhaltGleich(kopf, basis) {
  if (!gitGelingt(["cat-file", "-e", `${kopf}^{commit}`])) return false;
  const gemeinsam = git(["merge-base", kopf, basis]).trim();
  const kennung = patchKennung(gemeinsam, kopf);
  return kennung !== "" && kennung === patchKennung(basis, "HEAD");
}

function istGepruefterStand(kopf, basis) {
  const [stand, ...eltern] = git(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ");
  if (stand === kopf) return true;
  if (eltern.length + 1 === ELTERN_EINES_MERGES && eltern[1] === kopf) return true;
  return inhaltGleich(kopf, basis);
}

function prAngaben(pr, basis) {
  const { head = {}, base = {} } = pr;
  const eintrag = bereichAusBranch(head.ref, leseBereiche());
  verlange(
    eintrag !== undefined,
    `der Branch ${head.ref} heißt nicht genau ausmisten/<Bereich mit Quellen>`,
  );
  const basisRepo = base.repo?.id;
  verlange(
    Number.isInteger(basisRepo) && head.repo?.id === basisRepo,
    "der PR kommt aus einem Fork",
  );
  verlange(base.ref === ZIELBRANCH, "der PR zielt nicht auf master");
  verlange(
    SHA.test(head.sha ?? "") && istGepruefterStand(head.sha, basis),
    "der PR-Kopf ist nicht der geprüfte Stand",
  );
  return { bereich: eintrag.bereich, branch: head.ref, kopf: head.sha, repoId: basisRepo };
}

async function laufNummer(full, kopf) {
  const { statuses } = await getJson(`/repos/${full}/commits/${kopf}/status?per_page=100`);
  const status = (statuses ?? []).find(({ context }) => context === KONTEXT);
  verlange(status !== undefined, `kein Status „${KONTEXT}“ auf ${kopf}`);
  verlange(status.state === ERFOLG, `der Status „${KONTEXT}“ ist ${status.state}`);
  const praefix = `${env.GITHUB_SERVER_URL || STANDARD_SERVER}/${full}/actions/runs/`;
  const adresse = String(status.target_url ?? "");
  const nummer = adresse.startsWith(praefix)
    ? LAUF_NUMMER.exec(adresse.slice(praefix.length))
    : null;
  verlange(nummer !== null, `der Status „${KONTEXT}“ zeigt auf keinen Lauf dieses Repositorys`);
  return { nummer: Number(nummer[1]), adresse };
}

async function gueltigerLauf(full, angaben) {
  const { nummer, adresse } = await laufNummer(full, angaben.kopf);
  const lauf = await getJson(`/repos/${full}/actions/runs/${nummer}`);
  verlange(
    lauf.id === nummer && pfadUndEreignis(lauf, MESSUNG),
    "der Lauf ist kein workflow_run-Lauf von tests-ausmisten.yml",
  );
  const { id } = await getJson(`/repos/${full}/actions/workflows/${MESSUNG.datei}`);
  verlange(
    Number.isInteger(id) && lauf.workflow_id === id,
    "die Workflow-Nummer des Laufs gehört nicht zu tests-ausmisten.yml",
  );
  verlange(
    lauf.status === ABGESCHLOSSEN && lauf.conclusion === ERFOLG,
    "der Lauf ist nicht erfolgreich abgeschlossen",
  );
  verlange(lauf.head_branch === ZIELBRANCH, "der Lauf lief nicht auf master");
  const repos = [lauf.repository?.id, lauf.head_repository?.id];
  verlange(
    repos.every((repoId) => repoId === angaben.repoId),
    "der Lauf stammt aus einem anderen Repository",
  );
  verlange(
    lauf.display_title === laufTitel(angaben.kopf, angaben.branch),
    "der Titel des Laufs nennt nicht genau diesen PR-Kopf und Branch",
  );
  verlange(SHA.test(lauf.head_sha ?? ""), "der Lauf nennt keinen gemessenen master-Stand");
  return { adresse, gemessen: lauf.head_sha };
}

async function pruefeMessgrundlage(basis, { bereich, gemessen }) {
  verlange(
    gitGelingt(["merge-base", "--is-ancestor", gemessen, basis]),
    `der gemessene Stand ${gemessen} ist kein Vorfahr der Basis`,
  );
  const verstoesse = pfadVerstoesse({ von: basis, bis: "HEAD" });
  verlange(verstoesse.length === 0, verstoesse.join(" "));
  const graph = await graphImStand(basis);
  const alt = { rev: basis, graph };
  const geaendert = testaenderungen(basis, "HEAD");
  const menge = messmenge({ bereich, bereiche: leseBereiche(), geaendert, alt });
  const beobachtet = [...MESSGRUNDLAGE, ...menge.dateien, ...menge.beobachtet];
  const seither = git([
    "diff",
    "--name-only",
    "--no-renames",
    gemessen,
    basis,
    "--",
    ...beobachtet,
  ]);
  const liste = seither.split("\n").filter(Boolean);
  verlange(liste.length === 0, `seit der Messung geändert: ${liste.join(", ")}`);
}

export async function ausmistenFrei({ basis, pullRequest, stellen }) {
  const { full } = repositoryName();
  const pr = await getJson(`/repos/${full}/pulls/${pullRequest}`);
  const branch = String(pr.head?.ref ?? "").toLowerCase();
  if (!branch.startsWith(BRANCH_PRAEFIX)) return false;
  try {
    const angaben = prAngaben(pr, basis);
    const lauf = await gueltigerLauf(full, angaben);
    await pruefeMessgrundlage(basis, { ...angaben, ...lauf });
    console.log(
      `Testschutz: Ausnahme „${KONTEXT}“ für Bereich ${angaben.bereich}: Lauf ${lauf.adresse} hat ${angaben.kopf} gegen master ${lauf.gemessen} gemessen; ${stellen} geänderte oder gelöschte Stellen unter test/ sind frei.`,
    );
    return true;
  } catch (fehler) {
    console.error(`Testschutz: die Ausnahme „${KONTEXT}“ gilt nicht: ${fehler.message}.`);
    return false;
  }
}
