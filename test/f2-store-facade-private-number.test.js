// F2 - Regression-Guard fuer die store.js-FASSADE. Die Self-Service-Routen (P5/P6) UND
// finishCall->planSummarySms (P7) rufen store.setPrivateNumber / store.tenantPrivateNumber
// ueber die Fassade (src/store.js) auf - server.js injiziert genau diese. Die Fassade
// re-exportiert eine FESTE Namensliste (ESM kann "export * from <Variable>" nicht); fehlt
// ein Name, ist er auf der Fassade undefined und der Aufruf wirft erst zur LAUFZEIT einen
// TypeError. Die Unit-Tests maskieren das, weil sie einen Fake-Store / das pg-Backend
// direkt injizieren. Dieser Test importiert die ECHTE Fassade (json-Default, kein Boot,
// keine DB) und beweist, dass die Private-Number-API durchgereicht wird.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "../src/store.js";

test("store.js re-exportiert die F2-Private-Number-API (sonst TypeError zur Laufzeit)", () => {
  assert.equal(
    typeof store.tenantPrivateNumber,
    "function",
    "tenantPrivateNumber fehlt in der Fassade",
  );
  assert.equal(typeof store.setPrivateNumber, "function", "setPrivateNumber fehlt in der Fassade");
});
