import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;
const NOW = "2026-08-21T10:00:00.000Z";
const QUALIFIED_CALL_COUNT = 3;
const PARALLEL_POLL_COUNT = 6;
const NO_LIMIT_CAP = 20;

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
  return fetch(`${srv.localUrl}/api/inbox/poll`, { method: "POST" }).then((response) =>
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

test("INBOX-P2 C3: Struktur-Beleg - takeInboxEntries ist kein Thenable und markiert im selben synchronen Durchlauf", () => {
  const state = seedThreeQualifiedCalls("call_sync_");
  const result = ops.takeInboxEntries(state, BOOTSTRAP_TENANT_ID, {
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

  for (const entry of result.entries) {
    const matchingCall = state.calls.find((call) => call.id === entry.call_id);
    assert.notEqual(matchingCall.inboxSeenAt, null);
  }
});
