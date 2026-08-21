// INBOX-P1: Persistenz-Paritaet der zwei Inbox-Marker in BEIDEN Backends.
// Kern-Risiko (Pre-Mortem R-10, Lehre i8-design-decisions): ohne Spalte + Flush UND
// rowToCall-Hydrierung ginge ein Marker beim Restart verloren - und der naechste
// Voll-Flush schriebe NULL zurueck. Beide Felder werden EIGENSTAENDIG round-getrippt;
// inboxSeenAt wird in dieser Etappe noch von keinem Schreibweg gesetzt (das ist INBOX-P2)
// und deshalb direkt am Spiegel gesetzt - Muster test/store-pg-json-parity.test.js.
//
// DATA_DIR + config werden VOR allen store-Imports gebunden (json.FILE haengt an
// config.dataDir): darum laeuft die Verdrahtung ueber dynamische Imports in before()
// (Muster test/assistant-context-persist-pg.test.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SEEN_AT = "2026-08-21T09:00:00.000Z";

const LEGACY_ID = "call_legacy_ohne_marker";

let makePgStore, PGlite, jsonStore, BOOTSTRAP, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-inbox-parity-"));
  process.env.DATA_DIR = dataDir;
  // Bestands-store.json OHNE die zwei neuen Felder - geschrieben VOR dem ersten load(),
  // damit migrateCallFields (CALL_FIELD_DEFAULTS) sie ueberhaupt sieht.
  const { seedState, seedCall } = await import("./helpers.js");
  const legacy = seedCall({ id: LEGACY_ID, direction: "inbound", status: "completed" });
  delete legacy.inboxEntryAt;
  delete legacy.inboxSeenAt;
  fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify(seedState({ calls: [legacy] })));
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  jsonStore = await import("../src/store/json.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const newCall = (over = {}) => ({
  direction: "inbound",
  from: "+4915112345678",
  to: "+15005550006",
  tenantId: BOOTSTRAP,
  ...over,
});

test("INBOX-P1-S1 pg: frischer Call traegt beide Marker als null (nicht undefined)", async () => {
  const { store } = await makePgTestStore();
  const created = store.createCall(newCall());
  assert.equal(created.inboxEntryAt, null);
  assert.equal(created.inboxSeenAt, null);
});

test("INBOX-P1-S2 pg: inboxEntryAt ueberlebt den Reopen (Spalte + Flush + rowToCall)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  // Zeile VOR dem Marker flushen (Produktions-Reihenfolge, s. call-finish.js): der
  // zweite save() unten muss ein ON CONFLICT DO UPDATE sein, kein INSERT.
  await store.save();
  store.markInboxEntry(created.id, true);
  const gesetzt = store.getCall(created.id).inboxEntryAt;
  assert.ok(gesetzt, "Marker steht sofort im Spiegel");
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(created.id).inboxEntryAt, gesetzt);
});

test("INBOX-P1-S3 pg: inboxSeenAt ueberlebt den Reopen EIGENSTAENDIG (R-10)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  // Zeile VOR dem Marker flushen (Produktions-Reihenfolge, s. call-finish.js): der
  // zweite save() unten muss ein ON CONFLICT DO UPDATE sein, kein INSERT.
  await store.save();
  store.getCall(created.id).inboxSeenAt = SEEN_AT;
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(created.id).inboxSeenAt, SEEN_AT);
});

test("INBOX-P1-S4 pg: nicht gesetzte Marker hydrieren als null, NICHT als undefined", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  const hydriert = reopened.getCall(created.id);
  assert.equal(hydriert.inboxEntryAt, null);
  assert.equal(hydriert.inboxSeenAt, null);
  assert.ok("inboxEntryAt" in hydriert && "inboxSeenAt" in hydriert, "Felder existieren im Shape");
  assert.notEqual(hydriert.inboxEntryAt, undefined);
  assert.notEqual(hydriert.inboxSeenAt, undefined);
});

test("INBOX-P1-S5 pg: markInboxEntry ist set-once und bei qualifies=false ein No-op", async () => {
  const { store } = await makePgTestStore();
  const created = store.createCall(newCall());
  store.markInboxEntry(created.id, false);
  assert.equal(store.getCall(created.id).inboxEntryAt, null, "false -> kein Marker");
  store.markInboxEntry(created.id, true);
  const erster = store.getCall(created.id).inboxEntryAt;
  store.markInboxEntry(created.id, true);
  assert.equal(store.getCall(created.id).inboxEntryAt, erster, "set-once: der erste Stempel gewinnt");
});

test("INBOX-P1-S6 json: beide Marker round-trippen ueber die Platte", () => {
  const created = jsonStore.createCall(newCall());
  jsonStore.markInboxEntry(created.id, true);
  jsonStore.getCall(created.id).inboxSeenAt = SEEN_AT;
  jsonStore.save();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const zeile = onDisk.calls.find((call) => call.id === created.id);
  assert.ok(zeile.inboxEntryAt, "inboxEntryAt liegt auf Platte");
  assert.equal(zeile.inboxSeenAt, SEEN_AT);
});

test("INBOX-P1-S7 json: Bestandszeile ohne die Felder hydriert auf null (CALL_FIELD_DEFAULTS)", () => {
  const nachMigration = jsonStore.getCall(LEGACY_ID);
  assert.ok(nachMigration, "Bestandszeile wurde geladen");
  assert.equal(nachMigration.inboxEntryAt, null, "undefined waere json<->pg-Shape-Drift");
  assert.equal(nachMigration.inboxSeenAt, null);
});

test("INBOX-P1-S8: publicCall strippt BEIDE Marker (kein API-Leak)", async () => {
  const { publicCall } = await import("../src/store/views.js");
  const sichtbar = publicCall({ id: "call_x", inboxEntryAt: SEEN_AT, inboxSeenAt: SEEN_AT, summary: "x" });
  assert.deepEqual(Object.keys(sichtbar).sort(), ["id", "summary"]);
});
