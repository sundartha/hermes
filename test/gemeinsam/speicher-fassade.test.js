import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "../../src/store.js";

test("store.js re-exportiert die F2-Private-Number-API (sonst TypeError zur Laufzeit)", () => {
  assert.equal(
    typeof store.tenantPrivateNumber,
    "function",
    "tenantPrivateNumber fehlt in der Fassade",
  );
  assert.equal(typeof store.setPrivateNumber, "function", "setPrivateNumber fehlt in der Fassade");
});

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

test("store.js re-exportiert die Newsletter-Recipients-API (sonst TypeError zur Laufzeit)", () => {
  for (const name of [
    "tenantNewsletterRecipients",
    "confirmedNewsletterRecipients",
    "dailyNewsletterConfirmMailCount",
    "addNewsletterRecipient",
    "removeNewsletterRecipient",
    "confirmNewsletterRecipientByToken",
    "unsubscribeNewsletterRecipientByToken",
  ]) {
    assert.equal(typeof store[name], "function", `${name} fehlt in der Fassade`);
  }
});
