import assert from "node:assert/strict";
import { test } from "node:test";

import { laufBefunde, echteQuellen } from "../../tools/freigabe.mjs";

const KOPF = "a".repeat(40);
const MASTER_SPITZE = "1".repeat(40);
const ABZWEIG = "3".repeat(40);
const ANDERER_KOPF = "2".repeat(40);
const JETZT = Date.parse("2026-11-09T12:00:00Z");
const LOCK = "package-lock.json";
const PAKET = "package.json";
const ALT = "2025-01-01T00:00:00Z";

function lockfile(version, extra = {}) {
  return JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "hermes", version: "1.0.0" }, "node_modules/ws": { version }, ...extra } });
}

const STAENDE = {
  [MASTER_SPITZE]: { [LOCK]: lockfile("8.1.1"), [PAKET]: "{}" },
  [ABZWEIG]: { [LOCK]: lockfile("8.1.0"), [PAKET]: "{}" },
  [ANDERER_KOPF]: { [LOCK]: lockfile("8.1.0", { "node_modules/neu": { version: "1.0.0" } }), [PAKET]: '{"b":1}' },
};
const EIGEN = { basis: { [LOCK]: lockfile("8.1.0"), [PAKET]: "{}" }, kopf: { [LOCK]: lockfile("8.1.1"), [PAKET]: '{"a":1}' } };
const lesen = (ref, pfad) => (STAENDE[ref] ?? EIGEN[ref])[pfad];

function lauf(abzweig, voraus = {}) {
  const anderer = { number: 7, title: "Fach", head: { sha: ANDERER_KOPF, ref: "paket/fach" }, base: { sha: MASTER_SPITZE }, labels: [] };
  const pull = { number: 42, head: { sha: KOPF, ref: "paket/eigen" }, base: { ref: "master" }, title: "Eigen", user: { login: "sundartha-agent" }, labels: [] };
  const dateien = [{ status: "M", pfad: LOCK }, { status: "M", pfad: PAKET }];
  const quellen = {
    veroeffentlicht: async () => ALT,
    ersterFix: async () => false,
    nodeLtsSeit: async () => ALT,
    queueEintraege: async () => [],
    liegtVor: async () => false,
    notAus: async () => [],
    pull: async () => anderer,
    offenePRs: async () => [anderer],
    dateienVon: async () => [LOCK, PAKET],
    abzweig,
    ...voraus,
  };
  const reviews = [{ user: { login: "Antonio20045" }, state: "APPROVED", commit_id: KOPF, body: "PASS" }];
  return laufBefunde({ pull, reviews, dateien, imQueue: true, basis: "basis", kopf: "kopf", lesen, jetzt: JETZT, quellen });
}

test("ein Fach-PR mit neuer Abhängigkeit zählt trotz gehobener Version auf master nicht als Update", async () => {
  const befunde = await lauf(async (basis, kopf) => (basis === MASTER_SPITZE && kopf === ANDERER_KOPF ? ABZWEIG : basis));
  assert.deepEqual(befunde, ["Update-PR wartet: der offene PR #7 ändert ebenfalls package.json."]);
});

const wirft = async () => {
  throw new Error("Vergleich nicht erreichbar");
};

test("ein Fehler beim Ermitteln des Abzweigs ergibt in der Queue Update", async () => {
  const befunde = await lauf(wirft, { queueEintraege: async () => [{ pr: 7, sha: "c".repeat(40) }], liegtVor: async () => true });
  assert.deepEqual(befunde, ["Update-PR wartet: #7 ist noch in der Merge-Queue, höchstens ein Update zur Zeit.", "Update-PR wartet: der offene PR #7 ändert ebenfalls package.json."]);
});

test("ein Fehler beim Ermitteln des Abzweigs ergibt bei der Überschneidung Fach-PR", async () => {
  const befunde = await lauf(wirft);
  assert.deepEqual(befunde, ["Update-PR wartet: der offene PR #7 ändert ebenfalls package.json."]);
});

test("echteQuellen fragt den Abzweig über den Vergleich von GitHub", async () => {
  const echte = fetch;
  const adressen = [];
  globalThis.fetch = async (adresse) => {
    adressen.push(String(adresse));
    return { ok: true, headers: new Headers(), json: async () => ({ merge_base_commit: { sha: ABZWEIG } }) };
  };
  try {
    const quellen = echteQuellen({ base: { ref: "master" } }, KOPF);
    assert.equal(await quellen.abzweig(MASTER_SPITZE, ANDERER_KOPF), ABZWEIG);
    assert.ok(adressen[0].endsWith(`/compare/${MASTER_SPITZE}...${ANDERER_KOPF}`));
  } finally {
    globalThis.fetch = echte;
  }
});
