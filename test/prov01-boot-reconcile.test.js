// PROV-01 (F5): Boot-Sweep-Reconciler reconcileOrphanedProvisioning. Ein Prozess-Crash
// zwischen Enqueue und Drain laesst eine Nummer 'requested' + Job 'queued' haengen; beim
// naechsten Boot klassifiziert der fire-and-forget Sweep und fuehrt NUR den geld-sicheren
// redrive-Korb ueber den single-flight-Drain nach. Money-Safety (Regel 1): trotz einer
// bereits existierenden Provider-Order (Vor-Order) wird KEINE zweite Order gekauft
// (Idempotency-Key) und der Hold GENAU EINMAL captured. Observe-Only (maxAge=0),
// createdAt-alt und Dry-Run kaufen NICHTS. Server-Spawn (PAYMENT_ENABLED=true) + HTTP-Mocks
// fuer Telnyx (Order-Idempotenz) und Stripe (Hold/Capture) - EIGENE Datei, KEIN pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  TENANT_STATUS,
  KYC_LEVEL,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
  PROVIDER,
} from "../src/store/defaults.js";

const NUMBER_ID = "num_x";
const ORDER_KEY = `order_${NUMBER_ID}`; // Idempotency-Key aus onboarding.js (order_${numberId})
const PROVISION_KEY = `provision_${NUMBER_ID}`; // Job-Idempotenz aus queueProvisioning
const ORDERED_E164 = "+4915799990001";
const PROVIDER_NUMBER_ID = "num_ext_1";
const ONE_HOUR_MS = 3600000;

// Idempotenz-bewusster Telnyx-Provisioning-Mock: dedupliziert POST /v2/number_orders nach
// Idempotency-Key (Map key -> Order). seedPreOrder modelliert den Kauf des abgestuerzten
// Prozesses: ein Re-Order mit demselben Key erzeugt KEINE zweite effektive Order.
// orderCreations[key] = Anzahl NEU erzeugter Orders (>1 oder ein zweiter Key = Doppelkauf).
async function startTelnyxOrderIdempotentMock({ seedPreOrder = false } = {}) {
  const orders = new Map(); // idempotencyKey -> { id, phone_number }
  const orderCreations = {}; // idempotencyKey -> Anzahl NEU erzeugter Orders
  const orderPosts = []; // jeder empfangene POST-Key (Aufrufzaehler, unabhaengig vom Dedup)
  const create = (key) => {
    orders.set(key, { id: "ord_sub_1", phone_number: ORDERED_E164 });
    orderCreations[key] = (orderCreations[key] || 0) + 1;
  };
  if (seedPreOrder) create(ORDER_KEY); // geseedete Vor-Order

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v2/available_phone_numbers"))
        return res.end(JSON.stringify({ data: [{ phone_number: ORDERED_E164 }] }));
      if (req.url === "/v2/number_orders" && req.method === "POST") {
        const key = req.headers["idempotency-key"];
        orderPosts.push(key);
        if (!orders.has(key)) create(key); // Dedup: existierender Key -> keine neue Order
        const order = orders.get(key);
        return res.end(
          JSON.stringify({ data: { phone_numbers: [{ id: order.id, phone_number: order.phone_number }] } }),
        );
      }
      if (req.url.startsWith("/v2/phone_numbers?"))
        return res.end(JSON.stringify({ data: [{ id: PROVIDER_NUMBER_ID, phone_number: ORDERED_E164 }] }));
      res.end(JSON.stringify({ data: {} })); // release u.a.
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    orderCreations,
    orderPosts,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Stripe-Mock (PAYMENT_ENABLED): placeHold (POST /v1/payment_intents, idempotent nach
// Idempotency-Key) + captureHold (POST .../{id}/capture). captured = Set der captured PIs
// (>1 = Doppel-Capture). Nicht getroffene Pfade -> 200 {} (kein 500 durch Stray-Call).
async function startStripeHoldCaptureMock() {
  const intents = new Map(); // idempotencyKey -> pi-id
  const captured = new Set(); // captured PI-ids
  let seq = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const cap = req.url.match(/^\/v1\/payment_intents\/([^/]+)\/capture$/);
      if (cap) {
        captured.add(cap[1]);
        return res.end(JSON.stringify({ id: cap[1], status: "succeeded" }));
      }
      if (req.url === "/v1/payment_intents" && req.method === "POST") {
        const key = req.headers["idempotency-key"];
        if (key && intents.has(key)) return res.end(JSON.stringify({ id: intents.get(key) }));
        const id = `pi_${++seq}`;
        if (key) intents.set(key, id);
        return res.end(JSON.stringify({ id }));
      }
      res.end(JSON.stringify({}));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    captured,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Geseedeter Store: aktiver KYC-Subscriber t_user1 mit hinterlegter Karte, eine 'requested'
// Telnyx-DE-Nummer num_x + ein 'queued'-Job (Crash-Spur). jobOverrides justiert createdAt.
// startServer.ensureOwnerNumber ergaenzt die aktive Owner-Nummer (Boot-Guard) + Owner-Identitaet.
function seedStuck(jobOverrides = {}) {
  const s = makeDefaultState();
  s.tenants = [
    {
      id: "t_user1",
      status: TENANT_STATUS.ACTIVE,
      kycLevel: KYC_LEVEL.ID_VERIFIED,
      firstName: "Uwe",
      ownerName: "Uwe Test",
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
    },
  ];
  s.numbers = [
    {
      id: NUMBER_ID,
      tenantId: "t_user1",
      status: NUMBER_STATUS.REQUESTED,
      e164: null,
      provider: PROVIDER.TELNYX,
      country: "DE",
      providerNumberId: null,
    },
  ];
  s.provisioningJobs = [
    {
      id: "job_x",
      numberId: NUMBER_ID,
      tenantId: "t_user1",
      kind: PROVISION_NUMBER_JOB,
      status: PROVISIONING_JOB_STATUS.QUEUED,
      idempotencyKey: PROVISION_KEY,
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
      ...jobOverrides,
    },
  ];
  return s;
}

const PAY_ENV = {
  PROVISIONING_ENABLED: "true",
  PROVISIONING_COUNTRY: "DE",
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  NUMBER_SETUP_FEE_CENTS: "100",
  TELNYX_API_KEY: "KEYtest",
  TELNYX_CONNECTION_ID: "conn_1",
  MAX_NUMBERS: "10",
};

async function pollNumberStatus(srv, id, status, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const num = srv.readStore().numbers.find((n) => n.id === id);
    if (num && num.status === status) return num;
    if (Date.now() > deadline) return num;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function pollJobStatus(srv, id, status, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = srv.readStore().provisioningJobs.find((j) => j.id === id);
    if (job && job.status === status) return job;
    if (Date.now() > deadline) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 400)); // fire-and-forget Sweep abwarten

test("scharf (maxAge=1h, PAYMENT): junger stuck-requested -> active, GENAU EINE effektive Order + EIN captured PI trotz Vor-Order", async () => {
  const telnyx = await startTelnyxOrderIdempotentMock({ seedPreOrder: true });
  const stripe = await startStripeHoldCaptureMock();
  const srv = await startServer({
    seed: seedStuck(),
    env: {
      ...PAY_ENV,
      PROVISIONING_REDRIVE_MAX_AGE_MS: String(ONE_HOUR_MS),
      TELNYX_API_BASE: telnyx.url,
      STRIPE_API_BASE: stripe.url,
    },
  });
  try {
    const num = await pollNumberStatus(srv, NUMBER_ID, "active");
    assert.equal(num.status, "active");
    assert.equal(num.e164, ORDERED_E164);
    assert.equal(num.providerNumberId, PROVIDER_NUMBER_ID);
    // Money-Safety: die Vor-Order wurde WIEDERVERWENDET, nicht dupliziert.
    assert.equal(telnyx.orderCreations[ORDER_KEY], 1, "genau EINE effektive Order fuer den Key");
    assert.equal(Object.keys(telnyx.orderCreations).length, 1, "keine zweite (neue-numberId-)Order");
    assert.equal(telnyx.orderPosts.length, 1, "single-flight: genau EIN Order-POST");
    assert.equal(stripe.captured.size, 1, "genau EIN captured PI");
    assert.equal(srv.readStore().provisioningJobs.find((j) => j.id === "job_x").status, "done");
  } finally {
    await srv.stop();
    await telnyx.close();
    await stripe.close();
  }
});

test("Observe-Only (maxAge=0): stuck bleibt 'requested', hold-Log, KEIN Kauf", async () => {
  const telnyx = await startTelnyxOrderIdempotentMock();
  const stripe = await startStripeHoldCaptureMock();
  const srv = await startServer({
    seed: seedStuck(),
    env: {
      ...PAY_ENV,
      PROVISIONING_REDRIVE_MAX_AGE_MS: "0",
      TELNYX_API_BASE: telnyx.url,
      STRIPE_API_BASE: stripe.url,
    },
  });
  try {
    await settle();
    assert.equal(srv.readStore().numbers.find((n) => n.id === NUMBER_ID).status, "requested");
    assert.equal(telnyx.orderPosts.length, 0, "keine Order");
    assert.equal(stripe.captured.size, 0, "kein Capture");
    assert.match(srv.stdout, /\[provision-reconcile\] hold .*grund=too_old/);
  } finally {
    await srv.stop();
    await telnyx.close();
    await stripe.close();
  }
});

test("createdAt zu alt (> maxAge): stuck bleibt 'requested', hold-Log, KEIN Kauf", async () => {
  const telnyx = await startTelnyxOrderIdempotentMock();
  const stripe = await startStripeHoldCaptureMock();
  const srv = await startServer({
    seed: seedStuck({ createdAt: new Date(Date.now() - 2 * ONE_HOUR_MS).toISOString() }),
    env: {
      ...PAY_ENV,
      PROVISIONING_REDRIVE_MAX_AGE_MS: String(ONE_HOUR_MS),
      TELNYX_API_BASE: telnyx.url,
      STRIPE_API_BASE: stripe.url,
    },
  });
  try {
    await settle();
    assert.equal(srv.readStore().numbers.find((n) => n.id === NUMBER_ID).status, "requested");
    assert.equal(telnyx.orderPosts.length, 0);
    assert.equal(stripe.captured.size, 0);
    assert.match(srv.stdout, /\[provision-reconcile\] hold .*grund=too_old/);
  } finally {
    await srv.stop();
    await telnyx.close();
    await stripe.close();
  }
});

test("close-Korb: Nummer bereits 'active' -> Job wird 'done', KEIN Provider-Call", async () => {
  const telnyx = await startTelnyxOrderIdempotentMock();
  const stripe = await startStripeHoldCaptureMock();
  const seed = seedStuck();
  seed.numbers[0].status = NUMBER_STATUS.ACTIVE; // gegenstandslos: Nummer laengst durch
  seed.numbers[0].e164 = ORDERED_E164; // (z.B. manuelle Owner-Recovery vor dem Boot-Sweep)
  const srv = await startServer({
    seed,
    env: {
      ...PAY_ENV,
      PROVISIONING_REDRIVE_MAX_AGE_MS: String(ONE_HOUR_MS),
      TELNYX_API_BASE: telnyx.url,
      STRIPE_API_BASE: stripe.url,
    },
  });
  try {
    const job = await pollJobStatus(srv, "job_x", "done");
    assert.equal(job.status, "done", "gegenstandsloser Job wird geschlossen statt nachgekauft");
    assert.equal(srv.readStore().numbers.find((n) => n.id === NUMBER_ID).status, "active");
    assert.equal(telnyx.orderPosts.length, 0, "kein Nachkauf fuer eine bereits aktive Nummer");
    assert.equal(stripe.captured.size, 0, "kein Doppel-Capture fuer eine bereits aktive Nummer");
  } finally {
    await srv.stop();
    await telnyx.close();
    await stripe.close();
  }
});

test("Dry-Run (PROVISIONING_ENABLED=false): Sweep No-op, KEIN Provider-Call", async () => {
  const telnyx = await startTelnyxOrderIdempotentMock();
  const stripe = await startStripeHoldCaptureMock();
  const srv = await startServer({
    seed: seedStuck(),
    env: {
      ...PAY_ENV,
      PROVISIONING_ENABLED: "false",
      PROVISIONING_REDRIVE_MAX_AGE_MS: String(ONE_HOUR_MS),
      TELNYX_API_BASE: telnyx.url,
      STRIPE_API_BASE: stripe.url,
    },
  });
  try {
    await settle();
    assert.equal(srv.readStore().numbers.find((n) => n.id === NUMBER_ID).status, "requested");
    assert.equal(telnyx.orderPosts.length, 0);
    assert.equal(stripe.captured.size, 0);
  } finally {
    await srv.stop();
    await telnyx.close();
    await stripe.close();
  }
});
