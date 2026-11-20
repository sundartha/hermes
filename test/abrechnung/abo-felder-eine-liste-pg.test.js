import { test } from "node:test";
import assert from "node:assert/strict";
import { SUBSCRIPTION_PATCH_FIELDS } from "../../src/store.js";
import { makePgStore, makePgTestStore, legeMandantAn } from "../pg-helpers.js";

const TENANT = "user_5389_abo_felder";
const ZEITPUNKT = 1_900_000_000;

function wertFuer(feld, standard) {
  if (feld === "planSlug") return "starter";
  if (typeof standard === "boolean") return !standard;
  if (feld.startsWith("currentPeriod")) return ZEITPUNKT;
  return "sub_5389";
}

test("5389 pg: jedes Abo-Feld der gemeinsamen Liste wird fuer einen bestehenden Mandanten in die Datenbank geschrieben", async () => {
  const felder = Object.keys(SUBSCRIPTION_PATCH_FIELDS ?? {});
  assert.ok(felder.length > 0, "die Liste der Abo-Felder kommt aus dem Zustand (ein Eingang)");
  for (const feld of felder) {
    const { store, runner } = await makePgTestStore();
    await legeMandantAn(store, TENANT);
    await store.init();
    const standard = store.tenantSubscription(TENANT)[feld];
    const wert = wertFuer(feld, standard);
    store.setTenantSubscription(TENANT, { [feld]: wert });
    await store.drainFlushes();

    const store2 = makePgStore(runner);
    await store2.init();
    assert.equal(store2.tenantSubscription(TENANT)[feld], wert, `Feld ${feld} steht nach dem Neuladen in der Datenbank`);
  }
});
