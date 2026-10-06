import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const TENANT_GRANTED = "user_nl_granted";
const TENANT_REVOKED = "user_nl_revoked";
const TENANT_UNTOUCHED = "user_nl_untouched";

test("pg: newsletterConsent=true ueberlebt hydrate->flush->hydrate (Round-Trip)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_GRANTED, { firstName: "Max" });
  store.setNewsletterConsent(TENANT_GRANTED, true);

  const store2 = makePgStore(runner);
  await store2.init();
  const view = store2.tenantNewsletterConsent(TENANT_GRANTED);
  assert.equal(view.consent, true, "persistiert (flushTenants + rowToTenant)");
  assert.ok(view.consentAt, "Zeitstempel ueberlebt den Reload");
});

test("pg: Widerruf (false) NACH Einwilligung ueberlebt den Reload - beide Felder aktualisiert", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_REVOKED, { firstName: "Lea" });
  store.setNewsletterConsent(TENANT_REVOKED, true);
  store.setNewsletterConsent(TENANT_REVOKED, false);

  const store2 = makePgStore(runner);
  await store2.init();
  const view = store2.tenantNewsletterConsent(TENANT_REVOKED);
  assert.equal(view.consent, false, "Widerruf persistiert (nicht der urspruengliche Opt-in)");
  assert.ok(view.consentAt, "Zeitstempel des Widerrufs ueberlebt den Reload");
});

test("pg: Tenant ohne Einwilligung -> NULL/false, fail-closed Default nach Reload (kein Backfill)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_UNTOUCHED, { firstName: "Alt" });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.deepEqual(
    store2.tenantNewsletterConsent(TENANT_UNTOUCHED),
    { consent: false, consentAt: null },
    "additiv nullable, fail-closed Default - nie vorangekreuzt",
  );
});
