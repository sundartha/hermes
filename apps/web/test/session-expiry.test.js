import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  HTTP_UNAUTHORIZED,
  SESSION_EXPIRED_EVENT,
  fetchTenantState,
  notifySessionExpired,
  startBillingSetupCheckout,
} from "../src/lib/api.js";

const HTTP_OK = 200;
const HTTP_BAD_GATEWAY = 502;

function stubDocument() {
  const dispatched = [];
  globalThis.document = { dispatchEvent: (event) => dispatched.push(event.type) };
  return {
    dispatched,
    restore: () => {
      delete globalThis.document;
    },
  };
}

function stubFetch(status) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: status === HTTP_OK,
    status,
    json: async () => ({ url: "https://checkout.stripe.test/session" }),
  });
  return () => {
    globalThis.fetch = original;
  };
}

async function runWith(status, call) {
  const dom = stubDocument();
  const restoreFetch = stubFetch(status);
  try {
    await call().catch((err) => err);
    return dom.dispatched;
  } finally {
    restoreFetch();
    dom.restore();
  }
}

test("401 beim state-Fetch meldet SESSION_EXPIRED_EVENT", async () => {
  const dispatched = await runWith(HTTP_UNAUTHORIZED, fetchTenantState);
  assert.deepEqual(dispatched, [SESSION_EXPIRED_EVENT]);
});

test("401 beim Kartenwechsel meldet SESSION_EXPIRED_EVENT und wirft weiter ApiError(401)", async () => {
  const dom = stubDocument();
  const restoreFetch = stubFetch(HTTP_UNAUTHORIZED);
  try {
    await assert.rejects(
      startBillingSetupCheckout(),
      (err) => err instanceof ApiError && err.status === HTTP_UNAUTHORIZED,
    );
    assert.deepEqual(dom.dispatched, [SESSION_EXPIRED_EVENT]);
  } finally {
    restoreFetch();
    dom.restore();
  }
});

test("andere Fehler (502) melden KEINEN Sitzungsablauf", async () => {
  const dispatched = await runWith(HTTP_BAD_GATEWAY, startBillingSetupCheckout);
  assert.deepEqual(dispatched, []);
});

test("Erfolg meldet nichts", async () => {
  const dispatched = await runWith(HTTP_OK, startBillingSetupCheckout);
  assert.deepEqual(dispatched, []);
});

test("notifySessionExpired ohne DOM (Node) ist ein No-Op", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.doesNotThrow(() => notifySessionExpired());
});
