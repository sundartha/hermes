import assert from "node:assert/strict";
import { test } from "node:test";

import express from "express";

import { abrufMitFrist } from "./antwortfrist.mjs";

test("anmeldung-importrichtung: die Anruf-Lese-Route antwortet nur dem eigenen Prozess und sonst mit 403", async () => {
  const { makeReadRoutes } = await import("../../src/routes/api-read.ts");
  const erreicht = [];
  const tenant = {
    requestTenant: () => {
      erreicht.push("tenant");
      return "t";
    },
    requireTenant: () => "t",
    tenantOwnsCall: () => true,
  };
  const app = express();
  app.use(makeReadRoutes({ store: {}, config: {}, audit: () => {}, tenant }));
  const server = await new Promise((fertig) => {
    const s = app.listen(0, "127.0.0.1", () => fertig(s));
  });
  const zeilen = [];
  const original = console.log;
  console.log = (zeile) => zeilen.push(zeile);
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/calls/abc`;
    const antwort = await abrufMitFrist(url, { headers: { "x-forwarded-for": "203.0.113.7" } });
    assert.equal(antwort.status, 403);
    assert.deepEqual(await antwort.json(), { error: "Forbidden" });
    assert.deepEqual(erreicht, []);
    assert.equal(zeilen.length, 1);
    assert.match(zeilen[0], /^\[audit\] auth_failed ip=\S+ path=\/api\/calls\/abc grund=not_local$/);
    await abrufMitFrist(url);
    assert.deepEqual(erreicht, ["tenant"]);
  } finally {
    console.log = original;
    await new Promise((fertig) => server.close(fertig));
  }
});

test("anmeldung-importrichtung: die Audit-Zeile der abgewiesenen Anruf-Lese-Route nennt die Adresse des Aufrufers", async () => {
  const { makeReadRoutes } = await import("../../src/routes/api-read.ts");
  const tenant = { requestTenant: () => "t", requireTenant: () => "t", tenantOwnsCall: () => true };
  const app = express();
  app.use(makeReadRoutes({ store: {}, config: {}, audit: () => {}, tenant }));
  const server = await new Promise((fertig) => {
    const s = app.listen(0, "127.0.0.1", () => fertig(s));
  });
  const zeilen = [];
  const original = console.log;
  console.log = (zeile) => zeilen.push(zeile);
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/calls/abc`;
    await abrufMitFrist(url, { headers: { "x-forwarded-for": "203.0.113.7" } });
    assert.match(zeilen[0], /^\[audit\] auth_failed ip=(::ffff:)?127\.0\.0\.1 path=/);
  } finally {
    console.log = original;
    await new Promise((fertig) => server.close(fertig));
  }
});
