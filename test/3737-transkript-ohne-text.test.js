import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";

let store;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-3737b-"));
  await import("../src/config.js");
  store = await import("../src/store.js");
});

for (const fehlend of [undefined, null]) {
  test(`Transkript speichert fehlenden Text (${fehlend}) als leeren Text`, () => {
    const call = store.createCall({
      direction: "outbound",
      from: "+4930123456",
      to: "+4989123456",
      tenantId: "tenant-3737b",
      maxDurationS: 60,
    });
    store.addTranscript(call.id, "agent", fehlend);
    const eintrag = store.getCall(call.id).transcript[0];
    assert.equal(eintrag.text, "");
  });
}
