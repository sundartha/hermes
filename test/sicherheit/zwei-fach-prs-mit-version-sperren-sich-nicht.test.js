import assert from "node:assert/strict";
import { test } from "node:test";

import { laufBefunde } from "../../tools/freigabe.mjs";

const KOPF = "a".repeat(40);
const ANDERE_BASIS = "1".repeat(40);
const ANDERER_KOPF = "2".repeat(40);
const JETZT = Date.parse("2026-11-09T12:00:00Z");
const ANTONIO = { login: "Antonio20045" };
const LOCK = "package-lock.json";
const PAKET = "package.json";
const ALT = "2025-01-01T00:00:00Z";

function lockfile(version) {
  return JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "hermes", version: "1.0.0" }, "node_modules/ws": { version } } });
}

const EIGENER_STAND = { [LOCK]: [lockfile("8.1.0"), lockfile("8.1.1")], [PAKET]: ["{}", '{"a":1}'] };
const MIT_VERSION = { [LOCK]: [lockfile("8.1.0"), lockfile("8.1.1")], [PAKET]: ["{}", '{"b":1}'] };
const OHNE_VERSION = { [LOCK]: [lockfile("8.1.0"), lockfile("8.1.0")], [PAKET]: ["{}", '{"b":1}'] };
const VORAUS = { queueEintraege: async () => [{ pr: 7, sha: "c".repeat(40) }], liegtVor: async () => true };

function andererPull(stand, extra = {}) {
  const pull = { number: 7, title: "Fach", head: { sha: ANDERER_KOPF, ref: "paket/fach" }, base: { sha: ANDERE_BASIS }, labels: [], ...extra };
  const lesen = (ref, pfad) => (ref === ANDERE_BASIS ? stand[pfad]?.[0] : ref === ANDERER_KOPF ? stand[pfad]?.[1] : EIGENER_STAND[pfad]?.[ref === "basis" ? 0 : 1]);
  return { pull, lesen, dateienVon: async () => Object.keys(stand) };
}

function lauf(anderer, quellenExtra = {}) {
  const pull = { number: 42, head: { sha: KOPF, ref: "paket/eigen" }, base: { ref: "master" }, title: "Eigen", user: { login: "sundartha-agent" }, labels: [] };
  const dateien = Object.keys(EIGENER_STAND).map((pfad) => ({ status: "M", pfad }));
  const quellen = {
    veroeffentlicht: async () => ALT,
    ersterFix: async () => false,
    nodeLtsSeit: async () => ALT,
    queueEintraege: async () => [],
    liegtVor: async () => false,
    notAus: async () => [],
    pull: async () => anderer.pull,
    offenePRs: async () => [anderer.pull],
    dateienVon: anderer.dateienVon,
    ...quellenExtra,
  };
  const reviews = [{ user: ANTONIO, state: "APPROVED", commit_id: KOPF, body: "PASS" }];
  return laufBefunde({ pull, reviews, dateien, imQueue: true, basis: "basis", kopf: "kopf", lesen: anderer.lesen, jetzt: JETZT, quellen });
}

test("ein vorausliegender Fach-PR mit Versionsänderung ist ein Update vor dem eigenen", async () => {
  const befunde = await lauf(andererPull(MIT_VERSION), VORAUS);
  assert.deepEqual(befunde, ["Update-PR wartet: #7 ist noch in der Merge-Queue, höchstens ein Update zur Zeit."]);
});

test("zwei Fach-PRs mit Versionsänderung sperren sich nicht über die Paketdatei", async () => {
  assert.deepEqual(await lauf(andererPull(MIT_VERSION)), []);
});

test("ein Fach-PR ohne Versionsänderung sperrt weiter über dieselbe package.json", async () => {
  const befunde = await lauf(andererPull(OHNE_VERSION));
  assert.deepEqual(befunde, ["Update-PR wartet: der offene PR #7 ändert ebenfalls package.json."]);
});

test("ein Fach-PR ohne Versionsänderung in der Queue hält nicht auf", async () => {
  assert.deepEqual(await lauf(andererPull(OHNE_VERSION), { ...VORAUS, offenePRs: async () => [] }), []);
});

test("Dependabot-Branch und Node-Label gelten ohne Versionsänderung als Update", async () => {
  const meldung = ["Update-PR wartet: #7 ist noch in der Merge-Queue, höchstens ein Update zur Zeit."];
  assert.deepEqual(await lauf(andererPull(OHNE_VERSION, { head: { sha: ANDERER_KOPF, ref: "dependabot/npm_and_yarn/x" } }), VORAUS), meldung);
  assert.deepEqual(await lauf(andererPull(OHNE_VERSION, { labels: [{ name: "node-hauptversion" }] }), VORAUS), meldung);
});

test("dependabot-Pull ohne Versionsänderung sperrt nicht über die Paketdatei", async () => {
  const anderer = andererPull(OHNE_VERSION, { head: { sha: ANDERER_KOPF, ref: "dependabot/npm_and_yarn/x" } });
  assert.deepEqual(await lauf(anderer), []);
});

function erstesMalKaputt(anderer) {
  let aufrufe = 0;
  return async (nummer) => {
    aufrufe += 1;
    if (aufrufe === 1) throw new Error("weg");
    return anderer.dateienVon(nummer);
  };
}

test("ein nicht lesbarer Stand des anderen PR zählt in der Queue als Update", async () => {
  const anderer = andererPull(MIT_VERSION);
  const befunde = await lauf(anderer, { ...VORAUS, dateienVon: erstesMalKaputt(anderer) });
  assert.deepEqual(befunde, ["Update-PR wartet: #7 ist noch in der Merge-Queue, höchstens ein Update zur Zeit."]);
});

test("ein nicht lesbarer Stand des anderen PR zählt bei der Überschneidung als Fach-PR", async () => {
  const anderer = andererPull(MIT_VERSION);
  const befunde = await lauf(anderer, { dateienVon: erstesMalKaputt(anderer) });
  assert.deepEqual(befunde, ["Update-PR wartet: der offene PR #7 ändert ebenfalls package.json."]);
});

test("ein anderer PR ohne Stände wird nur am Branch erkannt", async () => {
  const anderer = andererPull(MIT_VERSION, { base: {}, head: { ref: "paket/fach" } });
  assert.deepEqual(await lauf(anderer, VORAUS), ["Update-PR wartet: der offene PR #7 ändert ebenfalls package.json."]);
});
