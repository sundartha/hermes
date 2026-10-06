import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "../src/store.js";

test("store.js re-exportiert die Newsletter-Consent-API (sonst TypeError zur Laufzeit)", () => {
  assert.equal(
    typeof store.tenantNewsletterConsent,
    "function",
    "tenantNewsletterConsent fehlt in der Fassade",
  );
  assert.equal(
    typeof store.setNewsletterConsent,
    "function",
    "setNewsletterConsent fehlt in der Fassade",
  );
});
