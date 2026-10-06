import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CTX = {
  summary: "Stammkunde will Freitag vormittag",
  recipient_relationship: "Stammfriseur",
  desired_outcome: "Termin Freitag vormittag",
  key_facts: ["Name Mueller", "bevorzugt vormittags"],
};

let makePgStore, PGlite, jsonStore, BOOTSTRAP, dataDir;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ctx-pg-"));
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

test("PG1: context round-trippt ueber Re-Hydrierung (JSONB-Spalte + rowToCall)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall({ context: CTX }));
  assert.deepEqual(store.load().calls[0].context, CTX, "im Spiegel sofort sichtbar");
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.deepEqual(
    reopened.getCall(created.id).context,
    CTX,
    "context ueberlebt den Reopen (Spalte + hydrate/flush gemappt)",
  );
});

test("PG2: ohne context -> null, round-trippt als null", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  assert.equal(created.context, null, "createCall ohne context -> null");
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(created.id).context, null, "NULL -> null (json-Parity)");
});

test("PG3: json-Backend persistiert context auf Platte (Roundtrip-Parity)", () => {
  const created = jsonStore.createCall(newCall({ context: CTX }));
  assert.deepEqual(jsonStore.load().calls[0].context, CTX, "json-Spiegel haelt context");
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const persisted = onDisk.calls.find((c) => c.id === created.id);
  assert.deepEqual(persisted.context, CTX, "context ueberlebt JSON.stringify/parse auf Platte");
});
