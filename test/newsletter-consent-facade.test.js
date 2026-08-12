// Regression-Guard fuer die store.js-FASSADE (Muster f2-store-facade-private-number.test.js).
// Die Self-Service-Route (self-service-routes.js) ruft store.setNewsletterConsent /
// store.tenantNewsletterConsent ueber die Fassade (src/store.js) auf - server.js/
// web-login.js injizieren genau diese. Die Fassade re-exportiert eine FESTE Namensliste
// (ESM kann "export * from <Variable>" nicht); fehlt ein Name, ist er auf der Fassade
// undefined und der Aufruf wirft erst zur LAUFZEIT einen TypeError. Dieser Test importiert
// die ECHTE Fassade (json-Default, kein Boot, keine DB) und beweist, dass die Newsletter-
// Consent-API durchgereicht wird.
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
