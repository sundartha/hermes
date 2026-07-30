// ORIG-05 (Katalog: tasks/i18n-tests/13-live-env-befund.md, Abschnitt 6 "Nachtrag: jeder
// Tenant hat eine US-Nummer - der Tarif weiss davon nichts").
//
// ORIG-01/02/03 sind mit P5 (Herkunfts-Achse) umgesetzt und leben als Regressionstests in
// test/cost-origin-axis.test.js weiter - deshalb stehen sie hier nicht mehr.
//
// ORIG-05 bleibt wie PAY-04 eine gruene CHARAKTERISIERUNG der Reserve-RECHNUNG
// (R3-Mechanismus, bleibt richtig): ein US-Tenant, der ein US-Ziel anruft, hat mit +1 kein
// Land mit gemessenem Inlandssatz - der Worst-Case-Satz gilt, die Reserve bleibt 1500 ct.
// Der Defekt sass in den WERTEN (Decke), nicht im Mechanismus.
//
// P7: die Rechnung selbst ist unveraendert (Worst-Case-Satz * Kappungs-Minuten), nur ihr
// ERGEBNIS gegen die Decke kippt - die generische Tenant-Decke steht seit P7 auf 1500 statt
// 600, damit reicht die Reserve genau. Dieses Kippen IST das SOLL, das GAP-33 formuliert
// (Auslandsziel muss durchkommen); das SOLL selbst fuehrt weiter test/prod-config-smoke.test.js.
//
// KS-P6/E1: der Worst-Case-Satz (voiceTariffDefaultCents) sank von 300 auf 30 ct/min (Messung
// statt Annahme, s. src/config.js). Die gepinnte Reserve sinkt dadurch mechanisch von 1500 auf
// 150 ct - die INHALTLICHE Aussage (Reserve <= Tenant-Decke) haelt weiter, mit groesserem
// Abstand als zuvor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { makeDefaultState, registerTenant, reserveExceedsBudget } from "../src/store/state-ops.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";

const TENANT_A = "t_orig";
const US_OWN_DID = "+15005550006"; // eigene DID des Tenants (keine +49/+33/+44-Vorwahl)
const US_TARGET = "+15551234567"; // ebenfalls keine Domestic-Vorwahl

test("Charakterisierung ORIG-05: US-Tenant ruft +1 (DID-Land == Ziel-Land) - Reserve 150 ct kommt seit P7 durch die Tenant-Decke 1500 ct", () => {
  const reserveCents =
    tariffCentsPerMin(US_TARGET, US_OWN_DID) * Math.ceil(MAX_CALL_DURATION_CAP_S / 60);
  assert.equal(reserveCents, 150, "Vorbedingung: live-gemessene Worst-Case-Reserve (KS-P6: 30 ct/min statt 300)");
  assert.equal(
    config.billing.defaultTenantBudgetCents,
    1500,
    "Vorbedingung: generische Tenant-Decke (Code-Fallback == render.yaml-Wert)",
  );

  const s = makeDefaultState();
  registerTenant(s, TENANT_A, {});
  // KEIN eigener Plan-Cap gesetzt -> effectiveCapCents faellt auf defaultTenantBudgetCents
  // (600) zurueck - das ist die Situation "US-Tenant ohne eigenen Plan".
  assert.equal(
    reserveExceedsBudget(s, TENANT_A, reserveCents, config.billing),
    false,
    "seit P7: auch wenn DID-Land und Ziel-Land beide US sind, gibt es fuer +1 keinen " +
      "gemessenen Inlandssatz - der Worst-Case-Satz gilt weiter, die generische Tenant-Decke " +
      "traegt die Reserve aber jetzt genau. Das SOLL fuer 'der Anruf soll durchkommen' " +
      "fuehrt test/prod-config-smoke.test.js (GAP-33, Auslandsziel)",
  );
});
