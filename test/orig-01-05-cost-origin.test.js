// ORIG-05 (Katalog: tasks/i18n-tests/13-live-env-befund.md, Abschnitt 6 "Nachtrag: jeder
// Tenant hat eine US-Nummer - der Tarif weiss davon nichts").
//
// ORIG-01/02/03 sind mit P5 (Herkunfts-Achse) umgesetzt und leben als Regressionstests in
// test/cost-origin-axis.test.js weiter - deshalb stehen sie hier nicht mehr.
//
// ORIG-05 bleibt wie PAY-04/GAP-32 eine gruene CHARAKTERISIERUNG der Reserve-RECHNUNG
// (R3-Mechanismus, bleibt richtig): ein US-Tenant, der ein US-Ziel anruft, hat mit +1 kein
// Land mit gemessenem Inlandssatz - der Worst-Case-Satz gilt, und die Reserve sprengt die
// generische Tenant-Decke schon vor dem Dial. Der Defekt sitzt in den WERTEN (Tarif/Decke),
// nicht im Mechanismus; das SOLL fuer "der Anruf soll durchkommen" fuehrt
// test/prod-config-smoke.test.js (GAP-33).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { makeDefaultState, registerTenant, reserveExceedsBudget } from "../src/store/state-ops.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";

const TENANT_A = "t_orig";
const US_OWN_DID = "+15005550006"; // eigene DID des Tenants (keine +49/+33/+44-Vorwahl)
const US_TARGET = "+15551234567"; // ebenfalls keine Domestic-Vorwahl

test("Charakterisierung ORIG-05: US-Tenant ruft +1 (DID-Land == Ziel-Land) - Reserve 1500 ct gegen Tenant-Decke 600 ct blockt trotzdem", () => {
  const reserveCents =
    tariffCentsPerMin(US_TARGET, US_OWN_DID) * Math.ceil(MAX_CALL_DURATION_CAP_S / 60);
  assert.equal(reserveCents, 1500, "Vorbedingung: live-gemessene Worst-Case-Reserve");
  assert.equal(
    config.billing.defaultTenantBudgetCents,
    600,
    "Vorbedingung: generische Tenant-Decke (Code-Fallback == render.yaml-Wert)",
  );

  const s = makeDefaultState();
  registerTenant(s, TENANT_A, {});
  // KEIN eigener Plan-Cap gesetzt -> effectiveCapCents faellt auf defaultTenantBudgetCents
  // (600) zurueck - das ist die Situation "US-Tenant ohne eigenen Plan".
  assert.equal(
    reserveExceedsBudget(s, TENANT_A, reserveCents, config.billing),
    true,
    "heutiger Stand: auch wenn DID-Land und Ziel-Land beide US sind, gibt es fuer +1 keinen " +
      "gemessenen Inlandssatz - der Worst-Case-Satz gilt und die Reserve sprengt die " +
      "generische Tenant-Decke VOR dem Dial. Das SOLL fuer 'der Anruf soll durchkommen' " +
      "fuehrt test/prod-config-smoke.test.js (GAP-33, Auslandsziel)",
  );
});
