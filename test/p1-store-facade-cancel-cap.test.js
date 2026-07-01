// P1 - Regression-Guard fuer die store.js-FASSADE (Muster f2-store-facade-private-number.test.js).
// billing/webhook.js (SUSPEND) UND billing/activation.js (ACTIVATE) rufen
// store.markTenantNumbersCancelled / store.reactivateTenantCancelledNumbers ueber die
// Fassade (src/store.js) auf - server.js injiziert genau diese. Die Fassade re-exportiert
// eine FESTE Namensliste (ESM kann "export * from <Variable>" nicht); fehlt ein Name, ist
// er auf der Fassade undefined und der Aufruf wirft erst zur LAUFZEIT einen TypeError. Die
// Unit-Tests maskieren das, weil sie einen Fake-Store injizieren. Dieser Test importiert die
// ECHTE Fassade (json-Default, kein Boot, keine DB) und beweist, dass die Cancel-Cap-API
// durchgereicht wird.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "../src/store.js";

test("store.js re-exportiert die P1-Cancel-Cap-API (sonst TypeError zur Laufzeit)", () => {
  assert.equal(
    typeof store.markTenantNumbersCancelled,
    "function",
    "markTenantNumbersCancelled fehlt in der Fassade",
  );
  assert.equal(
    typeof store.reactivateTenantCancelledNumbers,
    "function",
    "reactivateTenantCancelledNumbers fehlt in der Fassade",
  );
});
