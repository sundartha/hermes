import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const NOW = "2026-08-21T10:00:00.000Z";
const QUALIFIED_CALL_COUNT = 3;
const PARALLEL_POLL_COUNT = 6;
const NO_LIMIT_CAP = 20;
const OWNER_TENANT = "owner";

function seedThreeQualifiedCalls(prefix) {
  const calls = Array.from({ length: QUALIFIED_CALL_COUNT }, (_unused, index) =>
    seedCall({
      id: `${prefix}${index}`,
      direction: "inbound",
      status: "completed",
      startedAt: `2026-08-21T09:0${index}:00.000Z`,
      inboxEntryAt: NOW,
      inboxSeenAt: null,
    }),
  );
  return seedState({ calls });
}

function poll(srv) {
  return abrufMitFrist(`${srv.localUrl}/api/inbox/poll`, { method: "POST" }).then((response) =>
    response.json().then((body) => ({ status: response.status, body })),
  );
}

test("INBOX-P2 C1: zwei gleichzeitige Polls teilen sich die drei Eintraege ohne Ueberlappung", async () => {
  const srv = await startServer({ seed: seedThreeQualifiedCalls("call_race_") });
  try {
    const [resultA, resultB] = await Promise.all([poll(srv), poll(srv)]);
    assert.equal(resultA.status, HTTP_OK);
    assert.equal(resultB.status, HTTP_OK);
    const idsA = resultA.body.entries.map((entry) => entry.call_id);
    const idsB = resultB.body.entries.map((entry) => entry.call_id);
    const union = new Set([...idsA, ...idsB]);
    const intersection = idsA.filter((id) => idsB.includes(id));
    assert.equal(union.size, QUALIFIED_CALL_COUNT);
    assert.equal(intersection.length, 0);
    assert.equal(idsA.length + idsB.length, QUALIFIED_CALL_COUNT);
    assert.ok(idsA.length === 0 || idsB.length === 0, "genau eine Antwort ist leer");
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 C2: sechs parallele Polls liefern jede call_id genau einmal", async () => {
  const srv = await startServer({ seed: seedThreeQualifiedCalls("call_race6_") });
  try {
    const results = await Promise.all(
      Array.from({ length: PARALLEL_POLL_COUNT }, () => poll(srv)),
    );
    const allIds = results.flatMap((result) => result.body.entries.map((entry) => entry.call_id));
    assert.equal(allIds.length, QUALIFIED_CALL_COUNT);
    assert.equal(new Set(allIds).size, QUALIFIED_CALL_COUNT);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 C3: Struktur-Beleg - takeInboxEntries ist kein Thenable und markiert im selben synchronen Durchlauf", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-inbox-sync-"));
  fs.writeFileSync(
    path.join(dataDir, "store.json"),
    JSON.stringify(seedThreeQualifiedCalls("call_sync_")),
  );
  process.env.DATA_DIR = dataDir;
  try {
    const store = await import("../../src/store.js");
    const result = store.takeInboxEntries(OWNER_TENANT, {
      limit: NO_LIMIT_CAP,
      includeSeen: false,
    });

    assert.equal(
      typeof result.then,
      "undefined",
      "die Rueckgabe darf kein Thenable sein (kein await dazwischen)",
    );
    assert.equal(result.entries.length, QUALIFIED_CALL_COUNT);
    assert.equal(result.marked, QUALIFIED_CALL_COUNT);

    const { calls } = store.load();
    for (const entry of result.entries) {
      const matchingCall = calls.find((call) => call.id === entry.call_id);
      assert.notEqual(matchingCall.inboxSeenAt, null);
    }
  } finally {
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

const HTTP_BAD_REQUEST = 400;
const OFFSET_FEHLER = "offset muss eine ganze Zahl ab 0 sein";

const pollMitKoerper = (srv, koerper, typ = "application/json") =>
  abrufMitFrist(`${srv.localUrl}/api/inbox/poll`, {
    method: "POST",
    headers: { "content-type": typ },
    body: koerper,
  });

test("Poll: Körper ohne Objekt (Array, Text) wirkt wie ein leerer Körper, ungesehene Einträge kommen", async () => {
  for (const [koerper, typ] of [["[]", "application/json"], ["[1]", "application/json"], ["hallo", "text/plain"]]) {
    const srv = await startServer({ seed: seedThreeQualifiedCalls("call_koerper_") });
    try {
      const res = await pollMitKoerper(srv, koerper, typ);
      assert.equal(res.status, HTTP_OK, koerper);
      assert.equal((await res.json()).entries.length, QUALIFIED_CALL_COUNT, koerper);
    } finally {
      await srv.stop();
    }
  }
});

test("Poll: offset als null, Text, Bruch, Array oder Objekt wird bei include_seen mit 400 abgelehnt", async () => {
  const srv = await startServer({ seed: seedThreeQualifiedCalls("call_offset_") });
  try {
    for (const offset of [null, "5", 1.5, [1], {}]) {
      const res = await pollMitKoerper(srv, JSON.stringify({ include_seen: true, offset }));
      assert.equal(res.status, HTTP_BAD_REQUEST, JSON.stringify(offset));
      assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
    }
  } finally {
    await srv.stop();
  }
});

test("Poll: include_seen true liefert gesehene Einträge als Rückschau, in einem Array-Körper wirkt es nicht", async () => {
  const srv = await startServer({ seed: seedThreeQualifiedCalls("call_rueck_") });
  try {
    await pollMitKoerper(srv, "{}");
    const leer = await (await pollMitKoerper(srv, JSON.stringify([{ include_seen: true }]))).json();
    assert.deepEqual(leer.entries, []);
    const rueck = await (await pollMitKoerper(srv, JSON.stringify({ include_seen: true }))).json();
    assert.equal(rueck.entries.length, QUALIFIED_CALL_COUNT);
  } finally {
    await srv.stop();
  }
});
