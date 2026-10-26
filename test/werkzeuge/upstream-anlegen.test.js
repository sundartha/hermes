import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const UPSTREAM_URL = "https://github.com/sundartha/hermes";
const OWN_UPSTREAM_URL = "https://example.invalid/eigenes-upstream.git";
const PREPARE = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts.prepare;

function cloneWithOnlyOrigin(context) {
  const origin = probeRepository(context, { "LIESMICH.txt": "Probe\n" });
  const clone = join(probeDirectory(context, {}), "klon");
  const result = runIn(REPO_ROOT, "git", ["clone", "-q", origin, clone]);
  if (result.status !== 0) throw new Error(`git clone: ${result.stderr}`);
  return clone;
}

function runPrepare(directory) {
  symlinkSync(join(REPO_ROOT, "tools"), join(directory, "tools"));
  return runIn(directory, "sh", ["-c", PREPARE]);
}

function upstreamUrl(directory) {
  return runIn(directory, "git", ["remote", "get-url", "upstream"]).stdout.trim();
}

test("prepare legt in einem Klon mit nur origin das Remote upstream an", (context) => {
  const clone = cloneWithOnlyOrigin(context);

  const result = runPrepare(clone);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(upstreamUrl(clone), UPSTREAM_URL);
});

test("prepare laesst ein vorhandenes Remote upstream unveraendert", (context) => {
  const clone = cloneWithOnlyOrigin(context);
  runIn(clone, "git", ["remote", "add", "upstream", OWN_UPSTREAM_URL]);

  const result = runPrepare(clone);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(upstreamUrl(clone), OWN_UPSTREAM_URL);
});

test("prepare endet ausserhalb eines Git-Repos gruen und legt kein Repo an", (context) => {
  const directory = probeDirectory(context, {});

  const result = runPrepare(directory);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(directory, ".git")), false);
});
