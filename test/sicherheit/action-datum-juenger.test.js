import assert from "node:assert/strict";
import { test } from "node:test";

import { echteQuellen } from "../../tools/freigabe.mjs";

const SHA = "2".repeat(40);
const PULL = { number: 42, base: { ref: "master" } };
const GESTERN = "2026-11-08T00:00:00Z";
const ALT = "2024-12-01T00:00:00Z";

function antwort(koerper) {
  return new Response(JSON.stringify(koerper), { status: 200, headers: { "content-type": "application/json" } });
}

async function zeit(stand, releases, commitDatum) {
  const vorher = globalThis.fetch;
  const repoVorher = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "o/r";
  globalThis.fetch = async (adresse) => {
    const url = String(adresse);
    if (url.includes("/tags")) return antwort([{ name: "v1.0.0", commit: { sha: SHA } }]);
    if (url.includes("/releases")) return antwort(releases);
    if (url.includes("/commits/")) return antwort({ commit: { committer: { date: commitDatum } } });
    if (url.includes("/activity")) return antwort([{ ref: "refs/tags/v1.0.0", timestamp: ALT }]);
    return new Response("{}", { status: 404 });
  };
  try {
    return await echteQuellen(PULL, "d".repeat(40)).veroeffentlicht("actions", "a/b", stand);
  } finally {
    globalThis.fetch = vorher;
    if (repoVorher === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = repoVorher;
  }
}

test("ein altes Release auf einem neu verschobenen Tag zählt ab dem Commit-Datum", async () => {
  assert.equal(await zeit(SHA, [{ tag_name: "v1.0.0", published_at: ALT }], GESTERN), GESTERN);
});

test("ein Release, das jünger ist als der Commit, behält sein Datum", async () => {
  assert.equal(await zeit(SHA, [{ tag_name: "v1.0.0", published_at: GESTERN }], ALT), GESTERN);
});

test("ohne Release zu einem Tag des Commits bleibt das Commit-Datum", async () => {
  assert.equal(await zeit(SHA, [{ tag_name: "v9", published_at: ALT }], GESTERN), GESTERN);
});

test("ein Tag-Stand mit altem Release auf neuem Commit zählt ab dem Commit-Datum", async () => {
  assert.equal(await zeit("v1.0.0", [{ tag_name: "v1.0.0", published_at: ALT }], GESTERN), GESTERN);
});
