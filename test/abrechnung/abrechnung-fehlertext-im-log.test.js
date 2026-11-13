import assert from "node:assert/strict";
import { test } from "node:test";

import { fillPaymentMethodType } from "../../src/billing/payment-method-type-reconcile.ts";
import { reconcileStaleSubscriptions } from "../../src/billing/stale-subscription-reconcile.ts";

const TENANT = "t_fehlertext";

function aufzeichnenderLogger() {
  const zeilen = [];
  return { zeilen, warn: (zeile) => zeilen.push(zeile) };
}

const FEHLER_FAELLE = [
  { name: "Error mit Meldung", wirf: () => { throw new Error("Stripe unerreichbar"); }, text: "Stripe unerreichbar" },
  { name: "geworfener Text", wirf: () => { throw "Stripe weg"; }, text: "Stripe weg" },
];

for (const fall of FEHLER_FAELLE) {
  test(`Zahlungsmittel-Typ-Abfrage fehlgeschlagen (${fall.name}): Logzeile nennt Tenant und Fehlertext`, async () => {
    const logger = aufzeichnenderLogger();
    const ergebnis = await fillPaymentMethodType({
      store: {},
      billing: { retrievePaymentMethodType: async () => fall.wirf() },
      tenant: { id: TENANT, stripePaymentMethodId: "pm_x" },
      logger,
    });
    assert.equal(ergebnis.outcome, "lookup_failed");
    assert.deepEqual(logger.zeilen, [`[pm-type] Typ-Abfrage fehlgeschlagen tenant=${TENANT}: ${fall.text}`]);
  });

  test(`Abo-Statusabfrage fehlgeschlagen (${fall.name}): Logzeile nennt Tenant und Fehlertext`, async () => {
    const logger = aufzeichnenderLogger();
    const tenants = [{ id: TENANT, stripeSubscriptionId: "sub_x", status: "suspended" }];
    const bericht = await reconcileStaleSubscriptions({
      store: { load: () => ({ tenants }) },
      billing: { retrieveSubscription: async () => fall.wirf() },
      logger,
    });
    assert.deepEqual(bericht.errors, [{ id: TENANT, reason: "lookup_failed" }]);
    assert.deepEqual(logger.zeilen, [`[stale-subs] Statusabfrage fehlgeschlagen tenant=${TENANT}: ${fall.text}`]);
  });
}
