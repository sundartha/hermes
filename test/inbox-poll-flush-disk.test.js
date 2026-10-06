import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TENANT = BOOTSTRAP_TENANT_ID;

describe("INBOX-P2 Ebene B: json-Backend, save() NUR bei marked > 0", () => {
  let dataDir;
  let jsonStore;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-inbox-flush-"));
    const seed = seedState({ calls: [] });
    fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify(seed));
    process.env.DATA_DIR = dataDir;
    await import("../src/config.js");
    jsonStore = await import("../src/store/json.js");
    jsonStore.load();
  });

  after(() => {
    delete process.env.DATA_DIR;
  });

  function countingSaves(run) {
    const original = fs.renameSync;
    let count = 0;
    fs.renameSync = (...args) => {
      count += 1;
      return original(...args);
    };
    try {
      return { result: run(), count };
    } finally {
      fs.renameSync = original;
    }
  }

  test("B0: Positiv-Kontrolle des Messinstruments - jsonStore.save() zaehlt genau 1", () => {
    const { count } = countingSaves(() => jsonStore.save());
    assert.equal(count, 1);
  });

  test("B1: Leer-Poll (kein qualifizierter Call) -> 0 save(), marked=0", () => {
    const { result, count } = countingSaves(() =>
      jsonStore.takeInboxEntries(TENANT, { limit: 20, includeSeen: false }),
    );
    assert.equal(count, 0);
    assert.equal(result.marked, 0);
    assert.equal(result.entries.length, 0);
  });

  test("B2: ein neuer qualifizierter Call -> genau 1 save(), marked=1", () => {
    const call = seedCall({
      id: "call_flush_1",
      tenantId: TENANT,
      status: "completed",
      startedAt: "2026-08-21T09:00:00.000Z",
      inboxEntryAt: "2026-08-21T09:05:00.000Z",
      inboxSeenAt: null,
    });
    jsonStore.load().calls.push(call);

    const { result, count } = countingSaves(() =>
      jsonStore.takeInboxEntries(TENANT, { limit: 20, includeSeen: false }),
    );
    assert.equal(count, 1);
    assert.equal(result.marked, 1);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].call_id, "call_flush_1");
  });

  test("B3: zweiter Poll danach -> 0 save(), leer", () => {
    const { result, count } = countingSaves(() =>
      jsonStore.takeInboxEntries(TENANT, { limit: 20, includeSeen: false }),
    );
    assert.equal(count, 0);
    assert.equal(result.entries.length, 0);
  });

  test("B4: includeSeen:true liest erneut, OHNE zu markieren -> 0 save()", () => {
    const { result, count } = countingSaves(() =>
      jsonStore.takeInboxEntries(TENANT, { limit: 20, includeSeen: true }),
    );
    assert.equal(count, 0);
    assert.equal(result.marked, 0);
    assert.equal(result.entries.length, 1);
  });
});
