// Regression-Guard fuer die store.js-FASSADE (Muster newsletter-consent-facade.test.js /
// f2-store-facade-private-number.test.js). self-service-routes.js/mail-summary.js/
// call-finish.js rufen die Newsletter-Recipients-API ueber die Fassade (src/store.js) auf -
// fehlt ein Name, ist er auf der Fassade undefined und der Aufruf wirft erst zur LAUFZEIT
// einen TypeError. Dieser Test importiert die ECHTE Fassade (json-Default, kein Boot, keine
// DB) und beweist, dass die API durchgereicht wird.
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
