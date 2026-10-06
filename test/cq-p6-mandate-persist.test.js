import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MANDATE = {
  decide_freely: "Termin an einem Werktag zwischen 9 und 12 Uhr, bis 60 Euro",
  fallback_order: "zuerst Donnerstag, sonst Freitag",
  on_out_of_scope: "take_message",
};

let makePgStore, PGlite, jsonStore, BOOTSTRAP, dataDir;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-mandate-pg-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  jsonStore = await import("../src/store/json.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const newCall = (over = {}) => ({
  direction: "outbound",
  from: "+49",
  to: "+49",
  tenantId: BOOTSTRAP,
  ...over,
});

test("PM1: mandate round-trippt ueber Re-Hydrierung (JSONB-Spalte + rowToCall)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall({ mandate: MANDATE }));
  assert.deepEqual(store.load().calls[0].mandate, MANDATE, "im Spiegel sofort sichtbar");
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.deepEqual(
    reopened.getCall(created.id).mandate,
    MANDATE,
    "mandate ueberlebt den Reopen (Spalte + hydrate/flush gemappt)",
  );
});

test("PM2: ohne mandate -> null, round-trippt als null", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  assert.equal(created.mandate, null, "createCall ohne mandate -> null");
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(created.id).mandate, null, "NULL -> null (json-Parity)");
});

test("PM3: json-Backend persistiert mandate auf Platte (Roundtrip-Parity)", () => {
  const created = jsonStore.createCall(newCall({ mandate: MANDATE }));
  assert.deepEqual(jsonStore.load().calls[0].mandate, MANDATE, "json-Spiegel haelt mandate");
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const persisted = onDisk.calls.find((c) => c.id === created.id);
  assert.deepEqual(persisted.mandate, MANDATE, "mandate ueberlebt JSON.stringify/parse auf Platte");
});
