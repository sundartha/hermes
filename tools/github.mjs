import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { env } from "node:process";

export const APPROVERS = ["Antonio20045", "jonas986"];
const QUEUE_REF = /\/pr-(\d+)-[0-9a-f]+$/;
const API = "https://api.github.com";
const PER_PAGE = 100;
const FELDER_JE_DATEI = 2;

export function ereignis() {
  const daten = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  if (daten.merge_group) {
    const treffer = QUEUE_REF.exec(daten.merge_group.head_ref ?? "");
    if (!treffer) throw new Error(`Keine PR-Nummer im Ref ${daten.merge_group.head_ref}`);
    return { pr: Number(treffer[1]), basis: daten.merge_group.base_sha };
  }
  return { pr: daten.pull_request.number, basis: daten.pull_request.base.sha };
}

export async function api(pfad) {
  const antwort = await fetch(`${API}/repos/${env.GITHUB_REPOSITORY}${pfad}`, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
  });
  if (!antwort.ok) throw new Error(`GitHub ${pfad}: HTTP ${antwort.status}`);
  return antwort.json();
}

export function alleSeiten(pfad) {
  const trenner = pfad.includes("?") ? "&" : "?";
  return api(`${pfad}${trenner}per_page=${PER_PAGE}`);
}

export function geaenderteDateien(basis) {
  const felder = execFileSync("git", ["diff", "--no-renames", "--name-status", "-z", basis], {
    encoding: "utf8",
  }).split("\0");
  const dateien = [];
  for (let i = 0; i + 1 < felder.length; i += FELDER_JE_DATEI) dateien.push({ status: felder[i], pfad: felder[i + 1] });
  return dateien;
}

export function entfernteZeilen(basis, pfad) {
  const diff = execFileSync("git", ["diff", "-U0", basis, "--", pfad], { encoding: "utf8" });
  return diff.split("\n").filter((zeile) => zeile.startsWith("-") && !zeile.startsWith("---"));
}
