import assert from "node:assert/strict";
import { test } from "node:test";

import { subscriptionReturnPath } from "../../src/portal-paths.js";

const FAELLE = [
  { ausgang: { ok: true }, ziel: "/app?sub=ok" },
  { ausgang: { ok: false, reason: "already_subscribed" }, ziel: "/app?sub=ok" },
  { ausgang: { ok: false, reason: "subscription_conflict" }, ziel: "/app?sub=failed" },
  { ausgang: { ok: false, reason: "ein_neuer_grund" }, ziel: "/app?sub=failed" },
  { ausgang: { ok: false }, ziel: "/app?sub=failed" },
];

test("Abo-Rückkehr: nur ein aktives oder schon bestehendes Abo führt zu sub=ok, jeder andere Ausgang zu sub=failed", () => {
  for (const { ausgang, ziel } of FAELLE) {
    assert.equal(subscriptionReturnPath(ausgang), ziel, JSON.stringify(ausgang));
  }
});
