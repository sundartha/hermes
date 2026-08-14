// F2-Newsletter-Recipients (pg): Round-Trip hydrate->flush->hydrate. Deckt Schema
// (newsletter_recipients/newsletter_confirm_mail_log) + TENANT_COLUMNS + rowToTenant +
// flushTenants zusammen ab (I8-Landmine: fehlt eine Spalte an EINER der vier Stellen,
// loescht der naechste Flush den Wert oder er kommt nach einem Deploy-Neustart nie zurueck).
// pglite = kein Netz (F.I.R.S.T.). Muster newsletter-consent-pg-roundtrip.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const TENANT_WITH_RECIPIENTS = "user_nl_rec_a";
const TENANT_UNTOUCHED = "user_nl_rec_untouched";

test("pg: newsletterRecipients (pending + confirmed) ueberlebt hydrate->flush->hydrate", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_WITH_RECIPIENTS, { firstName: "Max" });
  store.addNewsletterRecipient(TENANT_WITH_RECIPIENTS, {
    email: "pending@example.test",
    tokenHash: "hash_pending",
    tokenExpiresAt: "2026-08-16T12:00:00.000Z",
    unsubToken: "unsub_pending",
  });
  store.addNewsletterRecipient(TENANT_WITH_RECIPIENTS, {
    email: "confirmed@example.test",
    tokenHash: "hash_confirmed",
    tokenExpiresAt: "2026-08-16T12:00:00.000Z",
    unsubToken: "unsub_confirmed",
  });
  const confirmResult = store.confirmNewsletterRecipientByToken("hash_confirmed", "2026-08-14T12:00:00.000Z");
  assert.ok(confirmResult, "Bestaetigung im Ausgangsstore erfolgreich");

  const store2 = makePgStore(runner); // frischer Store, gleiche DB -> hydriert aus der DB
  await store2.init();
  const recipients = store2.tenantNewsletterRecipients(TENANT_WITH_RECIPIENTS);
  assert.equal(recipients.length, 2, "beide Eintraege ueberleben den Reload");

  const pending = recipients.find((r) => r.email === "pending@example.test");
  assert.equal(pending.status, "pending");
  assert.equal(pending.tokenHash, "hash_pending", "Token ueberlebt, solange nicht bestaetigt");

  const confirmed = recipients.find((r) => r.email === "confirmed@example.test");
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.tokenHash, null, "geleerter Token ueberlebt als NULL (kein Zombie-Token)");
  assert.equal(confirmed.unsubToken, "unsub_confirmed", "permanenter Unsub-Token ueberlebt");

  const confirmedView = store2.confirmedNewsletterRecipients(TENANT_WITH_RECIPIENTS);
  assert.deepEqual(confirmedView.map((r) => r.email), ["confirmed@example.test"]);
});

test("pg: Entfernen eines Eintrags ueberlebt den Reload (Liste bleibt geleert, nicht nur lokal)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_WITH_RECIPIENTS + "_remove", { firstName: "Lea" });
  const tenantId = TENANT_WITH_RECIPIENTS + "_remove";
  store.addNewsletterRecipient(tenantId, {
    email: "weg@example.test",
    tokenHash: "h",
    tokenExpiresAt: "x",
    unsubToken: "u",
  });
  store.removeNewsletterRecipient(tenantId, "weg@example.test");

  const store2 = makePgStore(runner);
  await store2.init();
  assert.deepEqual(store2.tenantNewsletterRecipients(tenantId), []);
});

test("pg: Tageslimit-Log (newsletterConfirmMailLog) ueberlebt den Reload", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  const tenantId = TENANT_WITH_RECIPIENTS + "_daily";
  ops.registerTenant(s, tenantId, { firstName: "Tim" });
  store.addNewsletterRecipient(tenantId, {
    email: "a@example.test",
    tokenHash: "h",
    tokenExpiresAt: "x",
    unsubToken: "u",
    now: "2026-08-14T12:00:00.000Z",
  });

  const store2 = makePgStore(runner);
  await store2.init();
  const count = store2.dailyNewsletterConfirmMailCount(tenantId, "2026-08-14T00:00:00.000Z");
  assert.equal(count, 1, "Log-Eintrag ueberlebt den Reload und zaehlt im Fenster");
});

test("pg: Tenant ohne Zusatzempfaenger -> leere Liste nach Reload (kein Backfill, kein Muell)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_UNTOUCHED, { firstName: "Alt" });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.deepEqual(store2.tenantNewsletterRecipients(TENANT_UNTOUCHED), []);
  assert.equal(store2.dailyNewsletterConfirmMailCount(TENANT_UNTOUCHED, "2020-01-01T00:00:00.000Z"), 0);
});
