import { test } from "node:test";
import assert from "node:assert/strict";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

test("withConfigNamespaces lässt das übergebene Objekt unverändert", () => {
  const eingabe = Object.freeze({ paymentEnabled: true });
  const konfiguration = withConfigNamespaces(eingabe);
  assert.notEqual(konfiguration, eingabe);
  assert.deepEqual(Object.getOwnPropertyNames(eingabe), ["paymentEnabled"]);
  assert.equal(konfiguration.billing.paymentEnabled, true);
});

test("zwei Aufrufe mit derselben Konstante liefern getrennte Konfigurationen", () => {
  const gemeinsam = { paymentEnabled: true };
  const erste = withConfigNamespaces(gemeinsam);
  const zweite = withConfigNamespaces(gemeinsam);
  erste.billing.paymentEnabled = false;
  assert.equal(erste.paymentEnabled, false);
  assert.equal(zweite.billing.paymentEnabled, true);
  assert.equal(gemeinsam.paymentEnabled, true);
});
