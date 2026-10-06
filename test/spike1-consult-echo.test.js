import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  resolveWaitSeconds,
  DEFAULT_WAIT_SECONDS,
  MAX_WAIT_SECONDS,
} from "../scripts/spike1-consult-echo.mjs";

const SMALL_WAIT_SECONDS = 0.1;
const SMALL_WAIT_MS = 100;
const TIMING_TOLERANCE_MS = 15;
const HTTP_OK = 200;

test("spike1-consult-echo: antwortet nicht frueher als die eingestellte Wartezeit", async () => {
  const server = await startServer();
  try {
    const startedAt = Date.now();
    const res = await fetch(`${server.url}/?wait_seconds=${SMALL_WAIT_SECONDS}`);
    const elapsedMs = Date.now() - startedAt;
    await res.json();
    assert.ok(
      elapsedMs >= SMALL_WAIT_MS - TIMING_TOLERANCE_MS,
      `Antwort kam nach ${elapsedMs}ms, erwartet mindestens ~${SMALL_WAIT_MS}ms`,
    );
  } finally {
    await server.close();
  }
});

test("spike1-consult-echo: antwortet ueberhaupt und in der erwarteten Form", async () => {
  const server = await startServer();
  try {
    const res = await fetch(`${server.url}/?wait_seconds=${SMALL_WAIT_SECONDS}`);
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.wait_seconds, SMALL_WAIT_SECONDS);
    assert.equal(typeof body.waited_ms, "number");
    assert.equal(typeof body.received_at, "string");
    assert.equal(typeof body.responded_at, "string");
  } finally {
    await server.close();
  }
});

test("spike1-consult-echo: JSON-Body-Feld wait_seconds wird ebenfalls gelesen (Body schlaegt Query)", async () => {
  const server = await startServer();
  try {
    const res = await fetch(`${server.url}/?wait_seconds=${MAX_WAIT_SECONDS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wait_seconds: SMALL_WAIT_SECONDS }),
    });
    const body = await res.json();
    assert.equal(body.wait_seconds, SMALL_WAIT_SECONDS);
  } finally {
    await server.close();
  }
});

test("spike1-consult-echo: Wartezeit oberhalb der Obergrenze wird auf MAX_WAIT_SECONDS gekappt", () => {
  const url = new URL(`http://localhost/?wait_seconds=${MAX_WAIT_SECONDS + 1}`);
  assert.equal(resolveWaitSeconds(url, {}), MAX_WAIT_SECONDS);
});

test("spike1-consult-echo: fehlender Wert faellt auf den Standardwert zurueck", () => {
  const url = new URL("http://localhost/");
  assert.equal(resolveWaitSeconds(url, {}), DEFAULT_WAIT_SECONDS);
  assert.equal(resolveWaitSeconds(url, undefined), DEFAULT_WAIT_SECONDS);
});

test("spike1-consult-echo: unsinniger Wert (keine Zahl, negativ) faellt auf den Standardwert zurueck", () => {
  const nonNumeric = new URL("http://localhost/?wait_seconds=nicht-numerisch");
  assert.equal(resolveWaitSeconds(nonNumeric, {}), DEFAULT_WAIT_SECONDS);
  const negative = new URL("http://localhost/?wait_seconds=-5");
  assert.equal(resolveWaitSeconds(negative, {}), DEFAULT_WAIT_SECONDS);
});
