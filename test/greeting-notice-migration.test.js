import { test } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";
import { backfillGreetingNotices } from "../src/store/greeting-notice-migration.js";
import { INBOUND_NOTICES } from "../src/i18n/inbound-notice.js";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";

test("backfillGreetingNotices: markerlose Greetings bekommen den sprachrichtigen Satz voran, Rueckgabe = beide tenantIds", () => {
  const s = {
    settings: {
      de_tenant: { greeting: "Hallo, hier ist Hermes.", language: "de" },
      en_tenant: { greeting: "Hi, this is Hermes.", language: "en" },
    },
    numbers: [],
    tenants: [],
  };
  const changed = backfillGreetingNotices(s);
  assert.deepEqual(changed.sort(), ["de_tenant", "en_tenant"]);
  assert.ok(s.settings.de_tenant.greeting.startsWith(INBOUND_NOTICES.de));
  assert.ok(s.settings.en_tenant.greeting.startsWith(INBOUND_NOTICES.en));
});

test("backfillGreetingNotices: idempotent, zweiter Lauf aendert nichts", () => {
  const s = { settings: { t: { greeting: "Hallo, hier ist Hermes." } }, numbers: [], tenants: [] };
  backfillGreetingNotices(s);
  const afterFirst = s.settings.t.greeting;
  const changed = backfillGreetingNotices(s);
  assert.deepEqual(changed, []);
  assert.equal(s.settings.t.greeting, afterFirst);
});

test("backfillGreetingNotices: Nicht-String-Greeting bleibt unberuehrt (kein Crash, kein Write)", () => {
  const s = { settings: { broken: { greeting: null } } };
  const changed = backfillGreetingNotices(s);
  assert.deepEqual(changed, []);
  assert.equal(s.settings.broken.greeting, null);
});

test("backfillGreetingNotices: json.load() ergaenzt ein markerloses Bestandsgreeting, zweiter load() aendert nichts", async () => {
  const dir = tempDataDir();
  const fs = await import("fs");
  const path = await import("path");
  const config = (await import("../src/config.js")).config;
  const flat = {
    settings: { agentName: "Alt", greeting: "Hallo, hier ist Hermes.", language: "de" },
    calendar: [],
    numbers: [],
  };
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(flat, null, 2));
  config.server.dataDir = dir;
  const mod = await import(`../src/store/json.js?greeting-migration=${Date.now()}`);
  const state1 = mod.load();
  const owner = state1.settings[Object.keys(state1.settings)[0]];
  assert.ok(owner.greeting.includes(INBOUND_NOTICES.de), `Migration griff nicht: ${owner.greeting}`);
  const raw = fs.readFileSync(path.join(dir, "store.json"), "utf8");
  const persisted = JSON.parse(raw);
  const persistedOwner = persisted.settings[Object.keys(persisted.settings)[0]];
  assert.ok(
    persistedOwner.greeting.includes(INBOUND_NOTICES.de),
    "die Migration muss persistiert worden sein (save())",
  );
  const mod2 = await import(`../src/store/json.js?greeting-migration=${Date.now()}`);
  const state2 = mod2.load();
  const owner2 = state2.settings[Object.keys(state2.settings)[0]];
  assert.equal(owner2.greeting, owner.greeting, "zweiter load() ist ein No-Op");
});

test("backfillGreetingNotices: init() auf pg schreibt den Pflichtsatz in die DB-Zeile (FORCE-RLS-Pfad)", async () => {
  const { db } = await makePgTestStore();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  await db.query(`UPDATE settings SET greeting = $1, language = 'de' WHERE tenant_id = $2`, [
    "Hallo, hier ist Hermes.",
    BOOTSTRAP_TENANT_ID,
  ]);

  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store2 = makePgStore(runner);
  await store2.init();

  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  const { rows } = await db.query(`SELECT greeting FROM settings WHERE tenant_id = $1`, [
    BOOTSTRAP_TENANT_ID,
  ]);
  assert.ok(
    rows[0].greeting.includes(INBOUND_NOTICES.de),
    `DB-Zeile traegt den Pflichtsatz NICHT (FORCE-RLS-Schreibpfad kaputt): ${rows[0].greeting}`,
  );
});
