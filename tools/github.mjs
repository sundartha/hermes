import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { env } from "node:process";

export const APPROVERS = ["Antonio20045", "jonas986"];
export const AUTOMATION_LOGIN = "github-actions[bot]";
const QUEUE_REF = /\/pr-(\d+)-[0-9a-f]+$/;
const API = "https://api.github.com";
const PER_PAGE = 100;
const NAECHSTE_SEITE = /<([^>]+)>;\s*rel="next"/;
const FELDER_JE_DATEI = 2;
const GIT_PUFFER_BYTES = 268_435_456;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function holeKopf(pr) {
  const zugang = Buffer.from(`x-access-token:${env.GITHUB_TOKEN}`).toString("base64");
  const umgebung = { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${zugang}` };
  execFileSync("git", ["fetch", "--quiet", "--no-tags", "origin", `pull/${pr}/head`], { env: umgebung, stdio: "ignore" });
  return git(["rev-parse", "FETCH_HEAD"]);
}

export function ereignis() {
  const daten = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  if (!daten.merge_group) return { pr: daten.pull_request.number, basis: daten.pull_request.base.sha, kopf: undefined };
  const treffer = QUEUE_REF.exec(daten.merge_group.head_ref ?? "");
  if (!treffer) throw new Error(`Keine PR-Nummer im Ref ${daten.merge_group.head_ref}`);
  const kopf = holeKopf(treffer[1]);
  return { pr: Number(treffer[1]), basis: git(["merge-base", daten.merge_group.base_sha, kopf]), kopf, gruppenKopf: daten.merge_group.head_sha };
}

async function anfrage(adresse) {
  const antwort = await fetch(adresse, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
  });
  if (!antwort.ok) throw new Error(`GitHub ${adresse}: HTTP ${antwort.status}`);
  return { daten: await antwort.json(), weiter: NAECHSTE_SEITE.exec(antwort.headers.get("link") ?? "")?.[1] };
}

export async function api(pfad) {
  return (await anfrage(`${API}/repos/${env.GITHUB_REPOSITORY}${pfad}`)).daten;
}

export async function fremdeApi(repo, pfad) {
  return (await anfrage(`${API}/repos/${repo}${pfad}`)).daten;
}

export async function alleSeiten(pfad) {
  const trenner = pfad.includes("?") ? "&" : "?";
  const alle = [];
  let adresse = `${API}/repos/${env.GITHUB_REPOSITORY}${pfad}${trenner}per_page=${PER_PAGE}`;
  while (adresse !== undefined) {
    const { daten, weiter } = await anfrage(adresse);
    alle.push(...daten);
    adresse = weiter;
  }
  return alle;
}

export async function queueEintraege(zielBranch) {
  const refs = await alleSeiten(`/git/matching-refs/heads/gh-readonly-queue/${zielBranch}/pr-`);
  return refs.flatMap(({ ref, object }) => {
    const treffer = QUEUE_REF.exec(ref);
    return treffer ? [{ pr: Number(treffer[1]), sha: object.sha }] : [];
  });
}

function bereich(basis, kopf) {
  return kopf === undefined ? [basis] : [basis, kopf];
}

export function geaenderteDateien(basis, kopf) {
  const felder = git(["diff", "--no-renames", "--name-status", "-z", ...bereich(basis, kopf)]).split("\0");
  const dateien = [];
  for (let i = 0; i + 1 < felder.length; i += FELDER_JE_DATEI) dateien.push({ status: felder[i], pfad: felder[i + 1] });
  return dateien;
}

const QUELLDATEI = /\.(?:js|mjs|cjs|ts)$/;
const RELATIVER_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]*)\.js\2/g;

function mitNeuerEndung(zeile) {
  return zeile.replace(RELATIVER_IMPORT, "$1$2$3.ts$2");
}

function nurEndungGeaendert(entfernt, hinzu) {
  return entfernt !== hinzu && mitNeuerEndung(entfernt) === hinzu;
}

function bloecke(diff) {
  const liste = [];
  for (const zeile of diff.split("\n")) {
    if (zeile.startsWith("@@")) liste.push({ entfernt: [], hinzu: [] });
    else if (liste.length === 0) continue;
    else if (zeile.startsWith("-")) liste.at(-1).entfernt.push(zeile.slice(1));
    else if (zeile.startsWith("+")) liste.at(-1).hinzu.push(zeile.slice(1));
  }
  return liste;
}

function verbleibend({ entfernt, hinzu }, endungErlaubt) {
  if (!endungErlaubt || entfernt.length !== hinzu.length) return entfernt;
  return entfernt.filter((zeile, i) => !nurEndungGeaendert(zeile, hinzu[i]));
}

export function entfernteZeilen(basis, pfad, kopf) {
  const diff = git(["diff", "-U0", ...bereich(basis, kopf), "--", pfad]);
  return bloecke(diff).flatMap((block) => verbleibend(block, QUELLDATEI.test(pfad)));
}

export function inhaltAn(ref, pfad) {
  if (ref === undefined) return existsSync(pfad) ? readFileSync(pfad, "utf8") : undefined;
  if (git(["ls-tree", "--name-only", ref, "--", pfad]) === "") return undefined;
  return execFileSync("git", ["show", `${ref}:${pfad}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: GIT_PUFFER_BYTES });
}
