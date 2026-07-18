// PROV-01 (F6): captureHold in src/billing/stripe.js ist idempotenz-sicher. Ein zweiter
// Capture desselben PaymentIntent (z.B. Boot-Sweep-Re-Drive nach einem Crash zwischen
// erfolgreichem Capture und store.save()) lehnt Stripe mit payment_intent_unexpected_state
// + PI-Status 'succeeded' ab. Ohne Sonderbehandlung wirft captureHold -> provisionNumber
// rollt zurueck (rollbackAfterOrder) und gibt eine BEREITS BEZAHLTE Nummer frei. Mit F6
// gilt "already captured" als Erfolg -> die Nummer bleibt active. Praezise Diskriminierung:
// JEDER andere Stripe-Fehler (anderer code, anderer PI-Status) wirft weiter.
//
// Kein Server-Spawn, kein pglite: die reale stripeBilling-Logik wird gegen einen in-process
// HTTP-Mock getrieben (config.billing.stripeApiBase-Override; config ist nicht eingefroren -> Base-URL
// und Secret werden pro Test gesetzt und in finally wiederhergestellt).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { provisionNumber } from "../src/onboarding.js";
import { fakeProvisioner } from "./helpers.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantStripe,
  requestNumber,
  findNumber,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };
const CAPTURE_PATH = /^\/v1\/payment_intents\/([^/]+)\/capture$/;

// Dokumentierter Stripe-Fehlerkoerper "PaymentIntent bereits captured" (HTTP 400): code +
// PI-Status 'succeeded'. Genau diese Kombination behandelt F6 als Erfolg.
const ALREADY_CAPTURED_BODY = {
  error: {
    code: "payment_intent_unexpected_state",
    payment_intent: { id: "pi_seeded", status: "succeeded" },
  },
};

// Setzt Base-URL + Secret auf den Mock, ruft fn, stellt danach wieder her (Independent/R).
async function withStripeMock(url, fn) {
  const savedBase = config.billing.stripeApiBase;
  const savedKey = config.billing.stripeSecretKey;
  config.billing.stripeApiBase = url;
  config.billing.stripeSecretKey = "sk_test_x";
  try {
    return await fn();
  } finally {
    config.billing.stripeApiBase = savedBase;
    config.billing.stripeSecretKey = savedKey;
  }
}

// Mock, der JEDE Anfrage mit festem Status + JSON beantwortet (Diskriminierungs-Tests:
// der eine erwartete captureHold-POST bekommt genau diese Antwort).
async function startFixedServer(statusCode, json) {
  const server = http.createServer((req, res) => {
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(json));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Stateful Stripe-Mock: placeHold idempotent (Idempotency-Key -> pi-id); captureHold beim
// ERSTEN Capture eines PI -> 200 succeeded, bei jedem WEITEREN -> already-captured (400).
// captured = Menge der eingezogenen PIs (Groesse = effektive Captures).
async function startIdempotentStripeMock() {
  const intents = new Map(); // idempotencyKey -> pi-id
  const captured = new Set();
  let seq = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const cap = req.url.match(CAPTURE_PATH);
      if (cap && req.method === "POST") {
        const piId = cap[1];
        if (captured.has(piId)) {
          res.statusCode = 400;
          return res.end(
            JSON.stringify({
              error: {
                code: "payment_intent_unexpected_state",
                payment_intent: { id: piId, status: "succeeded" },
              },
            }),
          );
        }
        captured.add(piId);
        return res.end(JSON.stringify({ id: piId, status: "succeeded" }));
      }
      if (req.url === "/v1/payment_intents" && req.method === "POST") {
        const key = req.headers["idempotency-key"];
        if (key && intents.has(key)) return res.end(JSON.stringify({ id: intents.get(key) }));
        const id = `pi_${++seq}`;
        if (key) intents.set(key, id);
        return res.end(JSON.stringify({ id }));
      }
      res.end(JSON.stringify({ data: {} })); // cancel u.a.
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    captured,
    close: () => new Promise((r) => server.close(r)),
  };
}

function seedRequested() {
  const s = makeDefaultState();
  registerTenant(s, "t_user1");
  setTenantStripe(s, "t_user1", { customerId: "cus_1", paymentMethodId: "pm_1" });
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  return { s, numberId: number.id };
}

test("F6: 'already captured' (unexpected_state + PI succeeded) -> captureHold ist ERFOLG (kein Wurf)", async () => {
  const mock = await startFixedServer(400, ALREADY_CAPTURED_BODY);
  try {
    await withStripeMock(mock.url, () =>
      assert.doesNotReject(() => stripeBilling.captureHold("pi_seeded", 500)),
    );
  } finally {
    await mock.close();
  }
});

test("F6-Diskriminierung: generischer Stripe-Fehler (HTTP 500) wirft weiter", async () => {
  const mock = await startFixedServer(500, { error: { message: "boom" } });
  try {
    await withStripeMock(mock.url, () =>
      assert.rejects(
        () => stripeBilling.captureHold("pi_x", 500),
        /captureHold fehlgeschlagen: HTTP 500/,
      ),
    );
  } finally {
    await mock.close();
  }
});

test("F6-Diskriminierung: unexpected_state mit PI-Status != succeeded (canceled) wirft weiter", async () => {
  const mock = await startFixedServer(400, {
    error: {
      code: "payment_intent_unexpected_state",
      payment_intent: { id: "pi_x", status: "canceled" },
    },
  });
  try {
    await withStripeMock(mock.url, () =>
      assert.rejects(
        () => stripeBilling.captureHold("pi_x", 500),
        /captureHold fehlgeschlagen: HTTP 400/,
      ),
    );
  } finally {
    await mock.close();
  }
});

test("F6 end-to-end: provisionNumber zweimal auf derselben numberId -> zweiter Lauf active (NICHT released)", async () => {
  const mock = await startIdempotentStripeMock();
  const prov = fakeProvisioner();
  const { s, numberId } = seedRequested();
  try {
    await withStripeMock(mock.url, async () => {
      // Lauf 1: voller Erfolg -> Nummer active, PI beim Stripe-Mock captured.
      const first = await provisionNumber(
        s,
        { provisioner: prov, billing: stripeBilling },
        { numberId, ...ARGS },
      );
      assert.equal(first.status, NUMBER_STATUS.ACTIVE);

      // Crash-Simulation: die Aktivierung wurde NICHT persistiert -> der Boot-Sweep-Re-Drive
      // findet die Nummer wieder als 'requested' (der PI ist bei Stripe bereits captured).
      findNumber(s, numberId).status = NUMBER_STATUS.REQUESTED;

      // Lauf 2 (Re-Drive): placeHold idempotent -> gleicher PI; captureHold -> already-captured.
      // Mit F6 ist das ein Erfolg -> Nummer bleibt active, KEIN Release einer bezahlten Nummer.
      const second = await provisionNumber(
        s,
        { provisioner: prov, billing: stripeBilling },
        { numberId, ...ARGS },
      );
      assert.equal(second.status, NUMBER_STATUS.ACTIVE, "zweiter Lauf endet active, nicht released");
    });
    assert.equal(mock.captured.size, 1, "genau EIN effektiver Capture (kein Doppel-Einzug)");
  } finally {
    await mock.close();
  }
});
