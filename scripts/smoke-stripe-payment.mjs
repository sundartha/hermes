#!/usr/bin/env node
// Pay4-Smoke (manuelles Gate, NICHT Teil von npm test): beweist den vollen
// Onboard -> Customer -> payment_method -> Hold -> Capture-Zyklus gegen Stripe im
// TEST-MODE. Fail-closed (isTestKey): nur sk_test_-Keys, NIE live. Kein echter
// Nummernkauf - der injizierte Fake-Provisioner kauft strukturell nie (DIP).
// Geld als Ganzzahl-Cents. KEIN Secret in der Ausgabe (nur opake cus_/pi_-ids).
// Wird vom Lead direkt via `node scripts/smoke-stripe-payment.mjs` gefahren.
//
// Konstruktion/Anwendung getrennt (P15): dieses Skript ist die main-Ebene - es
// verdrahtet stripeBilling + Fake-Provisioner + in-memory-State und reicht sie an
// provisionNumber durch (wie runProvisioningDrain im Server, aber Stripe-Test statt Live).
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import { provisionNumber } from "../src/onboarding.js";
import { stripeBilling } from "../src/billing/stripe.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  setTenantStripe,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";
import { fakeProvisioner } from "../test/helpers.js"; // eine Quelle (G5): kein zweites Double

const TEST_KEY_PREFIX = "sk_test_"; // fail-closed: nur Stripe-TEST-Keys
const TEST_PAYMENT_METHOD = "pm_card_visa"; // Stripe-Test-Token (3DS-frei, sofort chargebar)
const SMOKE_TENANT = "t_smoke";
const SMOKE_AMOUNT_CENTS = 500; // Ganzzahl Cents (G26); Smoke-Betrag, nicht config-relevant
const SMOKE_CONNECTION_ID = "smoke_conn"; // Fake-Provisioner ignoriert den Wert
const SMOKE_MAX_NUMBERS = 1; // Cap-Notbremse: genau eine Smoke-Nummer
const PAYMENT_METHODS_PATH = "/v1/payment_methods";
const CUSTOMERS_PATH = "/v1/customers";

// Fail-closed: nur Stripe-TEST-Keys zugelassen. Reine Praedikat-Funktion (kein IO,
// kein Secret-Leak: prueft nur das Praefix, gibt den Key NIE zurueck/aus).
export function isTestKey(secretKey) {
  return typeof secretKey === "string" && secretKey.startsWith(TEST_KEY_PREFIX);
}

// Attacht die Stripe-Test-Karte an den Customer + setzt sie als default fuers
// off_session-Charging. Bewusst NUR im Smoke (nicht im Adapter): in Produktion
// macht das die Stripe-Checkout-Setup-Session aus Pay1 - hier ersetzt pm_card_visa
// die gehostete Seite. Kein Adapter-Edit -> kein toter Produktionscode (F4/G9).
// Secret-Key NIE in Fehlermeldungen leaken (Regel 4): nur HTTP-Status.
async function attachTestCard(customerId) {
  const headers = {
    Authorization: `Bearer ${config.stripeSecretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const attachBody = new URLSearchParams({ customer: customerId });
  const attached = await fetch(
    `${config.stripeApiBase}${PAYMENT_METHODS_PATH}/${TEST_PAYMENT_METHOD}/attach`,
    { method: "POST", headers, body: attachBody }
  );
  if (!attached.ok) throw new Error(`attach payment_method fehlgeschlagen: HTTP ${attached.status}`);

  const defaultBody = new URLSearchParams();
  defaultBody.set("invoice_settings[default_payment_method]", TEST_PAYMENT_METHOD);
  const setDefault = await fetch(`${config.stripeApiBase}${CUSTOMERS_PATH}/${customerId}`, {
    method: "POST",
    headers,
    body: defaultBody,
  });
  if (!setDefault.ok) throw new Error(`set default_payment_method fehlgeschlagen: HTTP ${setDefault.status}`);
  return TEST_PAYMENT_METHOD;
}

// Kompakte Ausgabe + Exit-Code (Muster aus telnyx-ws-echo.mjs). Eine Abstraktions-
// ebene (G30): druckt nur, was uebergeben wird - NIE den Secret-Key.
function report(smokePass, lines) {
  console.log(`smokePass=${smokePass}`);
  for (const line of lines) console.log(`  ${line}`);
  process.exit(smokePass ? 0 : 1);
}

async function main() {
  // Gate (fail-closed): nur Test-Key. Verhindert versehentlichen Live-Charge.
  if (!isTestKey(config.stripeSecretKey)) {
    report(false, ["STRIPE_SECRET_KEY fehlt oder ist KEIN sk_test_-Key (fail-closed, nie live)"]);
  }

  // Build: in-memory State mit aktivem Tenant (kein store/IO).
  const state = makeDefaultState();
  registerTenant(state, SMOKE_TENANT);

  // Schritt 1: echter Stripe-Test-Customer.
  const { customerId } = await stripeBilling.createCustomer({ tenantRef: SMOKE_TENANT });
  // Schritt 2: Test-Karte attachen + als default setzen.
  const paymentMethodId = await attachTestCard(customerId);
  setTenantStripe(state, SMOKE_TENANT, { customerId, paymentMethodId });

  const requested = requestNumber(state, {
    tenantId: SMOKE_TENANT,
    maxNumbers: SMOKE_MAX_NUMBERS,
    maxNumbersPerTenant: SMOKE_MAX_NUMBERS,
  });
  if (!requested.ok) report(false, [`requestNumber fehlgeschlagen: ${requested.reason}`]);

  // Schritt 3+4: provisionNumber mit Fake-Provisioner (kein echter Kauf) + echtem
  // Stripe-Test-Billing. placeHold -> requires_capture, captureHold -> succeeded.
  const result = await provisionNumber(
    state,
    { provisioner: fakeProvisioner(), billing: stripeBilling },
    {
      numberId: requested.number.id,
      countryCode: config.provisioningCountry,
      connectionId: SMOKE_CONNECTION_ID,
      holdAmountCents: SMOKE_AMOUNT_CENTS,
      currency: config.paymentCurrency,
    }
  );

  const ok = result.status === NUMBER_STATUS.ACTIVE && Boolean(result.paymentIntentId);
  // Nur opake ids ausgeben (cus_/pi_), NIE den Secret-Key (Regel 4).
  report(ok, [
    `customer=${customerId}`,
    `paymentIntent=${result.paymentIntentId}`,
    `numberStatus=${result.status} (erwartet: ${NUMBER_STATUS.ACTIVE})`,
    `betrag=${SMOKE_AMOUNT_CENTS} Cents ${config.paymentCurrency} (Hold->Capture durchgelaufen)`,
  ]);
}

// Nur als Skript ausfuehren, NICHT beim Import (der Offline-Guard-Test importiert
// isTestKey - main() darf dabei keinen Netz-Call/process.exit ausloesen).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => report(false, [`Smoke fehlgeschlagen: ${err.message}`]));
