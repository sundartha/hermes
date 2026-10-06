import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "../src/store.js";

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
