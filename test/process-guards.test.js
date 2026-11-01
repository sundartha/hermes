import { test } from "node:test";
import assert from "node:assert/strict";
import {
  installProcessGuards,
  onUnhandledRejection,
  onUncaughtException,
} from "../src/process-guards.js";
import { fehlerausgabeVon } from "./gemeinsam/fehlerausgabe.js";
import express from "express";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { registerPublicRoutes } from "../src/app.js";
import { mitRoutenServer } from "./anrufe/routen-server.js";

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const CONFIG = { server: { deployedCommit: "pg-test", webDistDir: "kein-web" } };

async function healthz() {
  const router = express.Router();
  registerPublicRoutes({ app: router, config: CONFIG, store: {} });
  return mitRoutenServer(router, async (basis) => {
    const antwort = await abrufMitFrist(`${basis}/healthz`);
    return { status: antwort.status, koerper: await antwort.json() };
  });
}

test("T-P0-01: installProcessGuards registriert beide Handler", () => {
  assert.ok(process.listeners("unhandledRejection").includes(onUnhandledRejection));
  assert.ok(process.listeners("uncaughtException").includes(onUncaughtException));
  const before = process
    .listeners("uncaughtException")
    .filter((l) => l === onUncaughtException).length;
  installProcessGuards();
  const after = process
    .listeners("uncaughtException")
    .filter((l) => l === onUncaughtException).length;
  assert.equal(after, before);
});

test("T-P0-02: onUnhandledRejection loggt und kehrt zurueck (kein throw/exit)", () => {
  let ret;
  const out = fehlerausgabeVon(() => {
    ret = onUnhandledRejection(new Error("boom-rejection"));
  }).join("\n");
  assert.equal(ret, undefined);
  assert.match(out, /\[guard\] unhandledRejection/);
  assert.match(out, /boom-rejection/);
});

test("B8-01: eine abgefangene unhandledRejection macht /healthz nicht krank", async () => {
  fehlerausgabeVon(() => onUnhandledRejection(new Error("einzelne-rejection")));
  assert.equal((await healthz()).status, HTTP_OK);
});

test("T-P0-03: onUncaughtException loggt stack, nie ein Secret", () => {
  const SECRET = "postgres://user:pw@db.internal:5432/secretdb";
  const err = new Error("ECONNREFUSED beim Boot");
  let ret;
  const out = fehlerausgabeVon(() => {
    ret = onUncaughtException(err);
  }).join("\n");
  assert.equal(ret, undefined);
  assert.match(out, /\[guard\] uncaughtException/);
  assert.ok(out.includes(err.stack), "stack soll geloggt werden (Diagnose)");
  assert.ok(!out.includes(SECRET), "Handler darf kein Secret aus config ziehen");
});

test("B8-02: eine abgefangene uncaughtException macht /healthz dauerhaft krank (503, Schaden fehler)", async () => {
  fehlerausgabeVon(() => onUncaughtException(new Error("schwerer-fehler")));
  assert.equal((await healthz()).status, HTTP_SERVICE_UNAVAILABLE);
  assert.deepEqual(await healthz(), {
    status: HTTP_SERVICE_UNAVAILABLE,
    koerper: { ok: false, schaden: "fehler", commit: "pg-test" },
  });
});
