import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TELNYX_GAP10_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PR = 42;
const TAG_MS = 86_400_000;
const KOPF_SHA = "a".repeat(40);
const ATTRAPPE = `
const zeit = process.env.ATTRAPPE_ZEIT;
const pull = { number: ${PR}, head: { sha: process.env.ATTRAPPE_KOPF, ref: "dependabot/npm_and_yarn/ws" }, base: { ref: "master" }, title: "Update ws", user: { login: "dependabot[bot]" }, labels: [] };
const reviews = [{ user: { login: "Antonio20045" }, state: "APPROVED", commit_id: process.env.ATTRAPPE_KOPF, body: "PASS" }];
function antwort(url) {
  const { hostname, pathname } = new URL(url);
  if (hostname === "registry.npmjs.org") return { time: { "8.1.1": zeit } };
  if (pathname.endsWith("/pulls/${PR}")) return pull;
  if (pathname.endsWith("/pulls/${PR}/reviews")) return reviews;
  return [];
}
globalThis.fetch = async (url) => new Response(JSON.stringify(antwort(String(url))), { status: 200 });
`;

function git(ordner, ...args) {
  return execFileSync("git", args, { cwd: ordner, encoding: "utf8" }).trim();
}

function lockfile(version) {
  return JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "hermes", version: "1.0.0" }, "node_modules/ws": { version } } });
}

function einrichten(ordner) {
  git(ordner, "init", "--quiet", "-b", "master");
  git(ordner, "config", "user.email", "t@example.test");
  git(ordner, "config", "user.name", "t");
  git(ordner, "remote", "add", "origin", ordner);
  writeFileSync(join(ordner, "package-lock.json"), lockfile("8.1.0"));
  git(ordner, "add", ".");
  git(ordner, "commit", "--quiet", "-m", "basis");
  const basis = git(ordner, "rev-parse", "HEAD");
  git(ordner, "checkout", "--quiet", "-b", "update");
  writeFileSync(join(ordner, "package-lock.json"), lockfile("8.1.1"));
  git(ordner, "commit", "--quiet", "-am", "update");
  git(ordner, "update-ref", `refs/pull/${PR}/head`, "HEAD");
  const kopf = git(ordner, "rev-parse", "HEAD");
  git(ordner, "checkout", "--quiet", "master");
  return { basis, kopf };
}

function freigabeLauf(alterTage) {
  const ordner = mkdtempSync(join(tmpdir(), "freigabe-queue-"));
  try {
    const { basis, kopf } = einrichten(ordner);
    const ereignisDatei = join(ordner, "..", `${ordner.split("/").pop()}-ereignis.json`);
    writeFileSync(ereignisDatei, JSON.stringify({ merge_group: { head_ref: `refs/heads/gh-readonly-queue/master/pr-${PR}-${"c".repeat(8)}`, base_sha: basis, head_sha: KOPF_SHA } }));
    const attrappe = join(ordner, "..", `${ordner.split("/").pop()}-attrappe.mjs`);
    writeFileSync(attrappe, ATTRAPPE);
    const ergebnis = spawnSync(process.execPath, [join(WURZEL, "tools", "freigabe.mjs")], {
      cwd: ordner,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(attrappe).href}`,
        GITHUB_EVENT_PATH: ereignisDatei,
        GITHUB_TOKEN: TELNYX_GAP10_SCHLUESSEL,
        GITHUB_REPOSITORY: "sundartha/hermes",
        ATTRAPPE_KOPF: kopf,
        ATTRAPPE_ZEIT: new Date(Date.now() - alterTage * TAG_MS).toISOString(),
      },
    });
    rmSync(ereignisDatei, { force: true });
    rmSync(attrappe, { force: true });
    return ergebnis;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("freigabe.mjs im merge_group-Ereignis meldet ein zu junges Update mit Exit-Code 1", () => {
  const ergebnis = freigabeLauf(1);
  assert.equal(ergebnis.status, 1, ergebnis.stdout + ergebnis.stderr);
  assert.match(ergebnis.stdout, /Update-PR: ws 8\.1\.1 ist jünger als 7 Tage\./);
});

test("freigabe.mjs im merge_group-Ereignis lässt dasselbe Update nach der Wartefrist durch", () => {
  const ergebnis = freigabeLauf(30);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.doesNotMatch(ergebnis.stdout, /Update-PR/);
});
