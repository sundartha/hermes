import assert from "node:assert/strict";
import { test } from "node:test";

import { echteQuellen } from "../../tools/freigabe.mjs";

const SHA = "2".repeat(40);
const PULL = { number: 42, base: { ref: "master" } };
const ALT = "2024-12-01T00:00:00Z";
const MITTE = "2026-10-01T00:00:00Z";
const GESTERN = "2026-11-08T00:00:00Z";
const HEUTE = "2026-11-16T00:00:00Z";

function antwort(koerper) {
  return new Response(JSON.stringify(koerper), { status: 200, headers: { "content-type": "application/json" } });
}

function bewegung(tag, timestamp) {
  return { ref: `refs/tags/${tag}`, timestamp, activity_type: "branch_creation" };
}

async function zeit({ stand = SHA, tags = ["v1"], release = ALT, commit = ALT, activity }) {
  const vorher = globalThis.fetch;
  const repoVorher = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "o/r";
  globalThis.fetch = async (adresse) => {
    const url = String(adresse);
    if (url.includes("/tags")) return antwort(tags.map((name) => ({ name, commit: { sha: SHA } })));
    if (url.includes("/releases")) return antwort(tags.map((tag) => ({ tag_name: tag, published_at: release })));
    if (url.includes("/commits/")) return antwort({ commit: { committer: { date: commit } } });
    if (url.includes("/activity")) return activity(new URL(url));
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

test("eine jüngere Bewegung des Tags zählt statt Release- und Committer-Datum", async () => {
  assert.equal(await zeit({ stand: "v1", activity: () => antwort([bewegung("v1", HEUTE)]) }), HEUTE);
});

test("die Abfrage nennt den Tag als vollständigen Ref", async () => {
  let ref;
  await zeit({ stand: "v1", activity: (url) => { ref = url.searchParams.get("ref"); return antwort([bewegung("v1", HEUTE)]); } });
  assert.equal(ref, "refs/tags/v1");
});

test("bei einem SHA-Stand zählt die jüngste Bewegung aller Tags des Commits", async () => {
  const eintraege = { v1: [bewegung("v1", MITTE)], v2: [bewegung("v2", GESTERN)] };
  const gefragt = [];
  const ergebnis = await zeit({ tags: ["v1", "v2"], activity: (url) => { gefragt.push(url.searchParams.get("ref")); return antwort(eintraege[url.searchParams.get("ref").slice(10)]); } });
  assert.equal(ergebnis, GESTERN);
  assert.deepEqual(gefragt, ["refs/tags/v1", "refs/tags/v2"]);
});

test("mehrere Bewegungen eines Tags: die jüngste zählt", async () => {
  assert.equal(await zeit({ activity: () => antwort([bewegung("v1", MITTE), bewegung("v1", GESTERN), bewegung("v1", ALT)]) }), GESTERN);
});

test("eine ältere Bewegung lässt das jüngste von Release und Commit stehen", async () => {
  assert.equal(await zeit({ release: GESTERN, commit: MITTE, activity: () => antwort([bewegung("v1", ALT)]) }), GESTERN);
  assert.equal(await zeit({ release: MITTE, commit: GESTERN, activity: () => antwort([bewegung("v1", ALT)]) }), GESTERN);
});

test("eine Activity-Abfrage mit Fehler macht das Alter nicht bestimmbar", async () => {
  await assert.rejects(zeit({ activity: () => new Response("{}", { status: 403 }) }), /HTTP 403/);
});

test("ohne Eintrag zum Ref ist das Alter nicht bestimmbar", async () => {
  await assert.rejects(zeit({ activity: () => antwort([]) }), /Alter nicht bestimmbar/);
  await assert.rejects(zeit({ activity: () => antwort([bewegung("anderer", HEUTE)]) }), /Alter nicht bestimmbar/);
});

test("ein SHA ohne Tag hat keine bestimmbare Bewegung", async () => {
  await assert.rejects(zeit({ tags: [], activity: () => antwort([bewegung("v1", HEUTE)]) }), /Alter nicht bestimmbar/);
});
