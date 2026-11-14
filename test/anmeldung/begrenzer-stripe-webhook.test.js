import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { importNachUmgebung } from "../gemeinsam/umgebung-import.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";

const LIMIT = 3;
const HTTP_BAD_REQUEST = 400;
const HTTP_TOO_MANY = 429;
const WEBHOOK_PFAD = "/webhooks/stripe";

const [{ wireWebLogin }, { makePgTestStore }] = await importNachUmgebung(
  { RATE_LIMIT_PER_MIN: String(LIMIT), SERVER_INSTANCES: "1" },
  () => import("../../src/wiring/web-login.js"),
  () => import("../pg-helpers.js"),
);

const basis = webLoginBasisKonfiguration("https://api.workos.test");
const KONFIGURATION = {
  ...basis,
  billing: { paymentEnabled: true, stripeWebhookSecret: "whsec_begrenzer" },
};

async function starteServer() {
  const { store, runner } = await makePgTestStore();
  const app = express();
  await wireWebLogin({
    app,
    config: KONFIGURATION,
    store,
    audit: () => {},
    provision: async () => ({ reason: "dry_run" }),
    createPortalRunner: () => runner,
    stripeWebhookPath: WEBHOOK_PFAD,
    appPath: "/app",
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return { basis: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("Begrenzer: POST auf den Stripe-Webhook prüft bis zum Limit die Signatur und antwortet danach mit 429 samt Retry-After", async () => {
  const s = await starteServer();
  try {
    const antworten = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      antworten.push(
        await abrufMitFrist(`${s.basis}${WEBHOOK_PFAD}`, {
          method: "POST",
          headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
          body: "{}",
        }),
      );
    }
    assert.deepEqual(
      antworten.map((a) => a.status),
      [HTTP_BAD_REQUEST, HTTP_BAD_REQUEST, HTTP_BAD_REQUEST, HTTP_TOO_MANY],
    );
    assert.ok(Number(antworten[LIMIT].headers.get("retry-after")) > 0);
  } finally {
    await s.close();
  }
});
