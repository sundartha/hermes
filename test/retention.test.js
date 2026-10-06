import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { tempDataDir, seedState, seedCall } from "./helpers.js";

const RETENTION_DAYS = 30;
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

const OLD = daysAgo(40);
const FRESH = daysAgo(1);

let store;
let dataDir;

before(async () => {
  dataDir = tempDataDir(
    seedState({
      calls: [
        seedCall({
          id: "call_old_done",
          status: "completed",
          startedAt: OLD,
          endedAt: OLD,
          transcript: [{ role: "caller", text: "altes Transkript", at: OLD }],
        }),
        seedCall({ id: "call_fresh_done", status: "completed", startedAt: FRESH, endedAt: FRESH }),
        seedCall({ id: "call_old_active", status: "active", startedAt: OLD, endedAt: null }),
      ],
      actionItems: [
        {
          id: "ai_old_done",
          callId: "call_old_done",
          text: "erledigt",
          type: "todo",
          done: true,
          createdAt: OLD,
        },
        {
          id: "ai_old_open",
          callId: "call_old_done",
          text: "offen",
          type: "todo",
          done: false,
          createdAt: OLD,
        },
      ],
      notifications: [
        { id: "nt_old", title: "alt", body: "", callId: null, at: OLD },
        { id: "nt_fresh", title: "frisch", body: "", callId: null, at: FRESH },
      ],
    }),
  );
  process.env.DATA_DIR = dataDir;
  store = await import("../src/store.js");
});

test("pruneOldData loescht nur Altes und Beendetes", () => {
  const removed = store.pruneOldData(RETENTION_DAYS);
  assert.deepEqual(removed, {
    calls: 1,
    notifications: 1,
    actionItems: 1,
    diagnosticTranscripts: 0,
    resultEvidence: 0,
  });

  const s = store.load();
  const callIds = s.calls.map((c) => c.id);
  assert.ok(!callIds.includes("call_old_done"), "alter beendeter Call ist weg (samt Transkript)");
  assert.ok(callIds.includes("call_fresh_done"), "frischer beendeter Call bleibt");
  assert.ok(callIds.includes("call_old_active"), "aktiver Call bleibt trotz Alter");

  assert.deepEqual(
    s.notifications.map((n) => n.id),
    ["nt_fresh"],
  );

  const itemIds = s.actionItems.map((a) => a.id);
  assert.ok(!itemIds.includes("ai_old_done"), "erledigtes altes Item ist weg");
  assert.ok(itemIds.includes("ai_old_open"), "offenes Item bleibt trotz Alter");
});

test("Loeschung ist persistiert (store.json auf Platte)", () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  assert.ok(!JSON.stringify(onDisk).includes("altes Transkript"));
  assert.ok(onDisk.calls.some((c) => c.id === "call_old_active"));
});

test("RETENTION_DAYS=0 schaltet die Retention ab", () => {
  const countsBefore = store.load().calls.length;
  assert.deepEqual(store.pruneOldData(0), {
    calls: 0,
    notifications: 0,
    actionItems: 0,
    diagnosticTranscripts: 0,
    resultEvidence: 0,
  });
  assert.equal(store.load().calls.length, countsBefore);
});
