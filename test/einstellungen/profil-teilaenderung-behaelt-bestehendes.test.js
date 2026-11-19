import assert from "node:assert/strict";
import { test } from "node:test";
import { makeDefaultState, setProfile } from "../../src/store/state-ops.js";

test("Profil: eine zweite Teiländerung behält die erste", () => {
  const state = makeDefaultState();
  setProfile(state, "t_profil", { maxCallsPerHour: 7 });
  const ergebnis = setProfile(state, "t_profil", { unrestricted: true });
  assert.equal(ergebnis.profile.maxCallsPerHour, 7);
  assert.equal(ergebnis.profile.unrestricted, true);
  assert.deepEqual(ergebnis.changed, ["unrestricted"]);
});
