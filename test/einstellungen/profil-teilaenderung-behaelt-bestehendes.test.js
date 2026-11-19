import assert from "node:assert/strict";
import { test } from "node:test";
import { makePgTestStore } from "../pg-helpers.js";

test("Profil: eine zweite Teiländerung behält die erste", async () => {
  const { store } = await makePgTestStore();
  store.setProfile("t_profil", { maxCallsPerHour: 7 });
  const ergebnis = store.setProfile("t_profil", { unrestricted: true });
  assert.equal(ergebnis.profile.maxCallsPerHour, 7);
  assert.equal(ergebnis.profile.unrestricted, true);
  assert.deepEqual(ergebnis.changed, ["unrestricted"]);
});
