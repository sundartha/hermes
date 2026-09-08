// SEC-P1: Persistenz-Round-Trip der Ereignis-Anker (webhookAnchors) in BEIDEN Backends.
// Kern-Risiko (Lehre I8): ohne Spalte + flush-ON-CONFLICT-DO-UPDATE-SET UND
// rowToCall-Hydrierung ginge der Anker beim Restart verloren - und der naechste Flush
// wuerde ihn ueberschreiben. Genau dann loeste eine Wiederholung nach einem Deploy
// wieder eine zweite Modellrunde aus (REPLAY-02).
// Muster test/al-p1-store-fields.test.js (pglite + json in-process, dynamische Imports
// NACH DATA_DIR-Bindung).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let makePgStore, PGlite, jsonStore, views, BOOTSTRAP, WEBHOOK_ANCHOR_HISTORY, dataDir;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-sec-p1-store-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  jsonStore = await import("../src/store/json.js");
  views = await import("../src/store/views.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP, WEBHOOK_ANCHOR_HISTORY } = await import(
    "../src/store/defaults.js"
  ));
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

// So viele Anker mehr, als der Ringpuffer haelt - der Deckel muss sie herauswerfen.
const UEBERLAUF = 2;

const newCall = (over = {}) => ({
  direction: "inbound",
  from: "+49",
  to: "+49",
  tenantId: BOOTSTRAP,
  ...over,
});

test("SEC-P1-9: webhookAnchors round-trippt ueber Re-Hydrierung (Spalte + flush + rowToCall)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  store.recordWebhookAnchors(created.id, ["t:aaaa", "e:bbbb"]);
  assert.deepEqual(store.getCall(created.id).webhookAnchors, ["t:aaaa", "e:bbbb"]);
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.deepEqual(
    reopened.getCall(created.id).webhookAnchors,
    ["t:aaaa", "e:bbbb"],
    "Anker ueberleben den Reopen (Spalte + ON CONFLICT DO UPDATE SET + rowToCall)",
  );
});

test("SEC-P1-10: der Ringpuffer deckelt bei WEBHOOK_ANCHOR_HISTORY, aelteste fallen raus", () => {
  const created = jsonStore.createCall(newCall());
  const total = WEBHOOK_ANCHOR_HISTORY + UEBERLAUF;
  for (let i = 0; i < total; i++) jsonStore.recordWebhookAnchors(created.id, [`t:${i}`]);
  const kept = jsonStore.getCall(created.id).webhookAnchors;
  assert.equal(kept.length, WEBHOOK_ANCHOR_HISTORY, "der Deckel haelt");
  assert.equal(kept[0], `t:${UEBERLAUF}`, "die aeltesten Anker sind herausgefallen");
  assert.equal(kept.at(-1), `t:${total - 1}`, "der juengste Anker steht am Ende");
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const persisted = onDisk.calls.find((call) => call.id === created.id);
  assert.deepEqual(
    persisted.webhookAnchors,
    kept,
    "Anker ueberleben JSON.stringify/parse (echter Disk-Roundtrip)",
  );
});

test("SEC-P1-11: bekannte Anker schreiben nicht doppelt, unbekannter Call wirft nicht", () => {
  const created = jsonStore.createCall(newCall());
  jsonStore.recordWebhookAnchors(created.id, ["e:dup"]);
  jsonStore.recordWebhookAnchors(created.id, ["e:dup"]);
  assert.deepEqual(jsonStore.getCall(created.id).webhookAnchors, ["e:dup"]);
  assert.equal(
    jsonStore.recordWebhookAnchors("call_gibt_es_nicht", ["e:x"]),
    null,
    "ein verspaeteter Retry fuer einen unbekannten Call darf den Setter nicht crashen",
  );
});

test("SEC-P1-12: publicCall strippt webhookAnchors (kein API-Leck)", () => {
  const stripped = views.publicCall({
    id: "call_x",
    webhookAnchors: ["e:sollte-nicht-leaken"],
    status: "active",
  });
  assert.equal(stripped.webhookAnchors, undefined, "Anker duerfen die API nicht verlassen");
  assert.equal(stripped.status, "active", "unbeteiligte Felder bleiben erhalten");
});
