#!/usr/bin/env node
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
import { PAYMENT_METHOD_TYPE_CARD } from "../src/billing/payment-method-eligibility.js";
import { fakeProvisioner } from "../test/helpers.js";

const TEST_KEY_PREFIX = "sk_test_";
const TEST_PAYMENT_METHOD = "pm_card_visa";
const SMOKE_TENANT = "t_smoke";
const SMOKE_AMOUNT_CENTS = 500;
const SMOKE_CONNECTION_ID = "smoke_conn";
const SMOKE_MAX_NUMBERS = 1;
const PAYMENT_METHODS_PATH = "/v1/payment_methods";
const CUSTOMERS_PATH = "/v1/customers";

export function isTestKey(secretKey) {
  return typeof secretKey === "string" && secretKey.startsWith(TEST_KEY_PREFIX);
}

async function attachTestCard(customerId) {
  const headers = {
    Authorization: `Bearer ${config.billing.stripeSecretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const attachBody = new URLSearchParams({ customer: customerId });
  const attached = await fetch(
    `${config.billing.stripeApiBase}${PAYMENT_METHODS_PATH}/${TEST_PAYMENT_METHOD}/attach`,
    { method: "POST", headers, body: attachBody },
  );
  if (!attached.ok)
    throw new Error(`attach payment_method fehlgeschlagen: HTTP ${attached.status}`);
  const attachedPaymentMethodId = (await attached.json().catch(() => ({}))).id;
  if (!attachedPaymentMethodId) throw new Error("attach payment_method lieferte keine id");

  const defaultBody = new URLSearchParams();
  defaultBody.set("invoice_settings[default_payment_method]", attachedPaymentMethodId);
  const setDefault = await fetch(`${config.billing.stripeApiBase}${CUSTOMERS_PATH}/${customerId}`, {
    method: "POST",
    headers,
    body: defaultBody,
  });
  if (!setDefault.ok)
    throw new Error(`set default_payment_method fehlgeschlagen: HTTP ${setDefault.status}`);
  return attachedPaymentMethodId;
}

function report(smokePass, lines) {
  console.log(`smokePass=${smokePass}`);
  for (const line of lines) console.log(`  ${line}`);
  process.exit(smokePass ? 0 : 1);
}

async function main() {
  if (!isTestKey(config.billing.stripeSecretKey)) {
    report(false, ["STRIPE_SECRET_KEY fehlt oder ist KEIN sk_test_-Key (fail-closed, nie live)"]);
  }

  const state = makeDefaultState();
  registerTenant(state, SMOKE_TENANT);

  const { customerId } = await stripeBilling.createCustomer({ tenantRef: SMOKE_TENANT });
  const paymentMethodId = await attachTestCard(customerId);
  setTenantStripe(state, SMOKE_TENANT, {
    customerId,
    paymentMethodId,
    paymentMethodType: PAYMENT_METHOD_TYPE_CARD,
  });

  const requested = requestNumber(state, {
    tenantId: SMOKE_TENANT,
    maxNumbers: SMOKE_MAX_NUMBERS,
    maxNumbersPerTenant: SMOKE_MAX_NUMBERS,
  });
  if (!requested.ok) report(false, [`requestNumber fehlgeschlagen: ${requested.reason}`]);

  const result = await provisionNumber(
    state,
    { provisioner: fakeProvisioner(), billing: stripeBilling },
    {
      numberId: requested.number.id,
      countryCode: config.provisioning.provisioningCountry,
      connectionId: SMOKE_CONNECTION_ID,
      holdAmountCents: SMOKE_AMOUNT_CENTS,
      currency: config.billing.paymentCurrency,
    },
  );

  const ok = result.status === NUMBER_STATUS.ACTIVE && Boolean(result.paymentIntentId);
  report(ok, [
    `customer=${customerId}`,
    `paymentIntent=${result.paymentIntentId}`,
    `numberStatus=${result.status} (erwartet: ${NUMBER_STATUS.ACTIVE})`,
    `betrag=${SMOKE_AMOUNT_CENTS} Cents ${config.billing.paymentCurrency} (Hold->Capture durchgelaufen)`,
  ]);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => report(false, [`Smoke fehlgeschlagen: ${err.message}`]));
