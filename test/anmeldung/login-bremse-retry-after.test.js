import { mock, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

process.env.STRIPE_SECRET_KEY = "sk_test_x";

const { wireWebLogin } = await import("../../src/wiring/web-login.js");
const { makePgTestStore } = await import("../pg-helpers.js");

const GRENZE = 2;
const HTTP_TOO_MANY = 429;
const FENSTER_MS = 60_000;
const START_MS = 1_800_000_000_000;

async function starten() {
  const { runner, store } = await makePgTestStore();
  const app = express();
  app.set("trust proxy", true);
  const basis = webLoginBasisKonfiguration("https://api.workos.test");
  await wireWebLogin({
    app,
    config: { ...basis, auth: { ...basis.auth, loginRateLimitPerMin: GRENZE } },
    store,
    audit: () => {},
    provision: async () => ({}),
    createPortalRunner: () => runner,
    stripeWebhookPath: "/webhooks/stripe",
    appPath: "/app",
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const login = (absender) =>
    abrufMitFrist(`http://127.0.0.1:${server.address().port}/auth/login`, {
      redirect: "manual",
      headers: { "x-forwarded-for": absender },
    });
  return { login, schliessen: () => server.close() };
}

async function sperreNach(bremse, absender, vergangenMs) {
  for (let i = 0; i < GRENZE; i += 1) await bremse.login(absender);
  mock.timers.tick(vergangenMs);
  const antwort = await bremse.login(absender);
  assert.equal(antwort.status, HTTP_TOO_MANY);
  return antwort.headers.get("retry-after");
}

test("Login-Bremse: Retry-After nennt Sekunden bis zum Fensterende, aufgerundet, zwischen 1 und 60", async () => {
  const bremse = await starten();
  mock.timers.enable({ apis: ["Date"], now: START_MS });
  try {
    assert.equal(await sperreNach(bremse, "198.51.100.1", 30_000), "30", "30 s vergangen");
    assert.equal(await sperreNach(bremse, "198.51.100.2", 29_500), "31", "angefangene Sekunde zählt");
    assert.equal(await sperreNach(bremse, "198.51.100.3", FENSTER_MS - 1), "1", "kurz vor Fensterende");
    assert.equal(await sperreNach(bremse, "198.51.100.4", 0), "60", "sofort nach Fensterbeginn");
  } finally {
    mock.timers.reset();
    bremse.schliessen();
  }
});
