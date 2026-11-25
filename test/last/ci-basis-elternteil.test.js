import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const WORKFLOW = parse(readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"));
const JOBS_MIT_BASIS = ["pruefungen", "semgrep", "rotprobe"];

function schrittBasis(job) {
  const schritte = WORKFLOW.jobs[job].steps;
  const index = schritte.findIndex((s) => typeof s.run === "string" && s.run.includes("GITHUB_ENV") && s.run.includes("BASIS="));
  assert.ok(index >= 0, `Job ${job} setzt BASIS nicht aus dem Elternteil`);
  return { schritt: schritte[index], index, schritte };
}

function git(verz, ...args) {
  return execFileSync("git", args, { cwd: verz, encoding: "utf8" }).trim();
}

function baueMerge() {
  const verz = mkdtempSync(join(tmpdir(), "basis-"));
  git(verz, "init", "-q", "-b", "master");
  git(verz, "config", "user.email", "t@example.invalid");
  git(verz, "config", "user.name", "t");
  const datei = (name, inhalt) => writeFileSync(join(verz, name), inhalt);
  datei("a.txt", "1");
  git(verz, "add", ".");
  git(verz, "commit", "-qm", "basis");
  const baseSha = git(verz, "rev-parse", "HEAD");
  git(verz, "checkout", "-qb", "pr");
  datei("x.txt", "pr");
  git(verz, "add", ".");
  git(verz, "commit", "-qm", "pr");
  git(verz, "checkout", "-q", "master");
  datei("fremd.txt", "master");
  git(verz, "add", ".");
  git(verz, "commit", "-qm", "master laeuft weiter");
  const masterSha = git(verz, "rev-parse", "HEAD");
  git(verz, "merge", "-q", "--no-ff", "-m", "merge", "pr");
  return { verz, baseSha, masterSha };
}

function fuehreAus(schritt, verz, umgebung) {
  const datei = join(mkdtempSync(join(tmpdir(), "env-")), "env");
  writeFileSync(datei, "");
  spawnSync("bash", ["-c", schritt.run], { cwd: verz, env: { ...process.env, ...umgebung, GITHUB_ENV: datei }, encoding: "utf8" });
  const text = readFileSync(datei, "utf8");
  rmSync(join(datei, ".."), { recursive: true, force: true });
  return text.trim();
}

for (const job of JOBS_MIT_BASIS) {
  test(`ci-basis-elternteil: ${job} nimmt auf pull_request den Elternteil des Merge-Commits als Basis, nicht base.sha`, () => {
    const { schritt } = schrittBasis(job);
    const { verz, baseSha, masterSha } = baueMerge();
    try {
      const gesetzt = fuehreAus(schritt, verz, { GITHUB_EVENT_NAME: "pull_request", BASIS: baseSha });
      assert.equal(gesetzt, `BASIS=${masterSha}`);
      const dateien = git(verz, "diff", "--name-only", masterSha, "HEAD");
      assert.equal(dateien, "x.txt");
      assert.match(git(verz, "diff", "--name-only", baseSha, "HEAD"), /fremd\.txt/);
    } finally {
      rmSync(verz, { recursive: true, force: true });
    }
  });

  test(`ci-basis-elternteil: ${job} lässt BASIS auf merge_group unverändert`, () => {
    const { schritt } = schrittBasis(job);
    assert.equal(String(schritt.if).replace(/\s/g, ""), "github.event_name=='pull_request'");
  });

  test(`ci-basis-elternteil: ${job} setzt BASIS vor dem ersten Schritt, der es benutzt`, () => {
    const { index, schritte } = schrittBasis(job);
    const erster = schritte.findIndex((s) => typeof s.run === "string" && s.run.includes('"$BASIS') && !s.run.includes("GITHUB_ENV"));
    assert.ok(erster > index, `${job}: Benutzung bei ${erster}, Setzen bei ${index}`);
  });
}

test("ci-basis-elternteil: Workflow-env behält base.sha und merge_group.base_sha als Rückfall", () => {
  assert.equal(WORKFLOW.env.BASIS, "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}");
});
