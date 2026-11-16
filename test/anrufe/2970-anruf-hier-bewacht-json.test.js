import assert from "node:assert/strict";
import { test } from "node:test";

import { seedCall, seedState, tempDataDir } from "../helpers.js";

const ALT = "2020-01-02T03:04:05.000Z";

test("BEWACHT-JSON-1: im JSON-Speicher ist nur ein laufender Anruf bewacht", async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [
        seedCall({ id: "call_json_laufend", status: "active" }),
        seedCall({ id: "call_json_fertig", status: "completed", endedAt: ALT }),
      ],
    }),
  );
  const store = await import("../../src/store.js");
  assert.equal(store.anrufHierBewacht("call_json_laufend"), true);
  assert.equal(store.anrufHierBewacht("call_json_fertig"), false);
  assert.equal(store.anrufHierBewacht("call_json_unbekannt"), false);
});
