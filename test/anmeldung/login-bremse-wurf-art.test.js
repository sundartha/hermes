import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { createGeteilterRateLimiter, mcpErlaubteOrigins } from "../../src/middleware.ts";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const GRENZE = 10;

async function anfrage(geworfen) {
  const zeilen = [];
  const { error } = console;
  console.error = (...teile) => zeilen.push(teile.join(" "));
  const app = express();
  const bremse = createGeteilterRateLimiter({
    zaehlen: () => Promise.reject(geworfen),
    limitPerMin: GRENZE,
  });
  app.get("/login", bremse, (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const laufend = app.listen(0, "127.0.0.1", () => resolve(laufend));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/login`);
    return { antwort, koerper: await antwort.json(), zeilen };
  } finally {
    console.error = error;
    await new Promise((resolve) => server.close(resolve));
  }
}

const WUERFE = [
  ["Error", new Error("kaputt"), "kaputt"],
  ["Text", "boom", "boom"],
  ["Zahl", 42, "42"],
  ["null", null, "null"],
];

for (const [art, geworfen, text] of WUERFE) {
  test(`Login-Bremse Zählung wirft ${art}: 503 mit Retry-After 5 und Logzeile mit ${text}`, async () => {
    const { antwort, koerper, zeilen } = await anfrage(geworfen);
    assert.equal(antwort.status, HTTP_UNAVAILABLE);
    assert.equal(antwort.headers.get("retry-after"), "5");
    assert.deepEqual(koerper, { error: "service unavailable" });
    assert.deepEqual(zeilen, [`[login-bremse] ${text}`]);
  });
}

test("Login-Bremse: ohne Ausfall der Zählung läuft die Anfrage durch", async () => {
  const app = express();
  const bremse = createGeteilterRateLimiter({
    zaehlen: () => Promise.resolve({ anzahl: 1, beginnMs: Date.now() }),
    limitPerMin: GRENZE,
  });
  app.get("/login", bremse, (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const laufend = app.listen(0, "127.0.0.1", () => resolve(laufend));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/login`);
    assert.equal(antwort.status, HTTP_OK);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const ORIGIN_FAELLE = [
  [
    "ungültige Einträge entfallen",
    { publicUrl: "https://a.test", zusaetzlicheOrigins: ["müll", "foo://x", ""] },
    ["https://a.test"],
  ],
  [
    "Duplikate einmal",
    {
      publicUrl: "https://a.test",
      zusaetzlicheOrigins: ["https://A.test/", "https://b.test", "https://b.test"],
    },
    ["https://a.test", "https://b.test"],
  ],
  ["leere publicUrl", { publicUrl: "" }, []],
  [
    "fehlende publicUrl",
    { publicUrl: undefined, zusaetzlicheOrigins: ["https://b.test"] },
    ["https://b.test"],
  ],
];

for (const [name, eingabe, erwartet] of ORIGIN_FAELLE) {
  test(`mcpErlaubteOrigins: ${name}`, () => {
    assert.deepEqual(mcpErlaubteOrigins(eingabe), erwartet);
  });
}
