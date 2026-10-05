import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { env } from "node:process";

import { githubZugang } from "../auftrag/pruefer-github.mjs";

const WARTESCHLANGEN_REF = /^(?:refs\/heads\/)?gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]{7,40}$/;
const CI_LAEUFE_AM_KOPF = "/actions/workflows/ci.yml/runs?event=pull_request&head_sha=";
const ERFOLG = "success";
const LEERRAUM = /\s+/;
const MAX_GIT_AUSGABE = 268_435_456;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

export function prNummerAus(ref) {
  const treffer = WARTESCHLANGEN_REF.exec(String(ref ?? ""));
  return treffer === null ? null : Number(treffer[1]);
}

export function schreibeAusgabe(werte) {
  if (!env.GITHUB_OUTPUT) return;
  const zeilen = Object.entries(werte).map(([name, wert]) => `${name}=${wert}\n`);
  appendFileSync(env.GITHUB_OUTPUT, zeilen.join(""));
}

export function git(args, { root, eingabe } = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input: eingabe,
    maxBuffer: MAX_GIT_AUSGABE,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function zusammenfuehrungsbasis(erster, zweiter, root) {
  return git(["merge-base", erster, zweiter], { root }).trim();
}

export function patchIdZwischen(von, bis, root) {
  const diff = git(["diff", "--no-color", "--no-ext-diff", von, bis], { root });
  if (diff === "") return "";
  const ausgabe = git(["patch-id", "--verbatim"], { root, eingabe: diff });
  return ausgabe.trim().split(LEERRAUM)[0] ?? "";
}

export async function prKopf(nummer, { github, root }) {
  const pull = await github.hole(`/pulls/${nummer}`);
  const kopf = String(pull?.head?.sha ?? "");
  git(["fetch", "--quiet", "--no-tags", "origin", `pull/${nummer}/head`], { root });
  git(["cat-file", "-e", kopf + "^{commit}"], { root });
  return kopf;
}

export function gleicheAenderungGegenBasis({ basis, kopf }, root) {
  const warteschlange = patchIdZwischen(basis, "HEAD", root);
  const pr = patchIdZwischen(zusammenfuehrungsbasis(basis, kopf, root), kopf, root);
  return { gleich: warteschlange !== "" && warteschlange === pr, patchId: warteschlange };
}

async function letzterCiLauf(kopf, github) {
  const { workflow_runs: laeufe = [] } = await github.hole(`${CI_LAEUFE_AM_KOPF}${kopf}`);
  return laeufe[0] ?? null;
}

function grundDagegen(aenderung, lauf) {
  if (aenderung.patchId === "") return "die Änderung in der Warteschlange ist leer";
  if (!aenderung.gleich) return "die Patch-ID in der Warteschlange weicht vom PR-Kopf ab";
  if (lauf?.conclusion !== ERFOLG) {
    return `der letzte CI-Lauf am PR-Kopf endete ${lauf?.conclusion ?? "ohne Ergebnis"}`;
  }
  return null;
}

export function prNummer({ ref }) {
  const nummer = prNummerAus(ref);
  if (nummer === null) {
    console.error(`Keine PR-Nummer im Ref ${JSON.stringify(ref)}.`);
    return EXIT_FEHLER;
  }
  schreibeAusgabe({ pr: nummer });
  console.log(nummer);
  return EXIT_OK;
}

export async function gleicherStand({ ref, basis }, root, github = githubZugang()) {
  const nummer = prNummerAus(ref);
  if (nummer === null) {
    console.error(`Keine PR-Nummer im Ref ${JSON.stringify(ref)}.`);
    return EXIT_FEHLER;
  }
  const kopf = await prKopf(nummer, { github, root });
  const aenderung = gleicheAenderungGegenBasis({ basis, kopf }, root);
  const lauf = await letzterCiLauf(kopf, github);
  const grund = grundDagegen(aenderung, lauf);
  schreibeAusgabe({ pr: nummer, kopf, gleich: String(grund === null) });
  console.log(
    grund === null
      ? `Gleicher Stand: ja, PR #${nummer}, Kopf ${kopf}, Patch-ID ${aenderung.patchId}, CI-Lauf ${lauf.html_url}`
      : `Gleicher Stand: nein (${grund})`,
  );
  return EXIT_OK;
}
