import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { env } from "node:process";

export const APPROVERS = ["Antonio20045", "jonas986"];
const QUEUE_REF = /\/pr-(\d+)-[0-9a-f]+$/;
const API = "https://api.github.com";
const PER_PAGE = 100;
const NAECHSTE_SEITE = /<([^>]+)>;\s*rel="next"/;
const FELDER_JE_DATEI = 2;

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
  return { pr: Number(treffer[1]), basis: git(["merge-base", daten.merge_group.base_sha, kopf]), kopf };
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

function bereich(basis, kopf) {
  return kopf === undefined ? [basis] : [basis, kopf];
}

export function geaenderteDateien(basis, kopf) {
  const felder = git(["diff", "--no-renames", "--name-status", "-z", ...bereich(basis, kopf)]).split("\0");
  const dateien = [];
  for (let i = 0; i + 1 < felder.length; i += FELDER_JE_DATEI) dateien.push({ status: felder[i], pfad: felder[i + 1] });
  return dateien;
}

export function entfernteZeilen(basis, pfad, kopf) {
  const diff = git(["diff", "-U0", ...bereich(basis, kopf), "--", pfad]);
  return diff.split("\n").filter((zeile) => zeile.startsWith("-") && !zeile.startsWith("---"));
}
