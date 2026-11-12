import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";

const ANRUF = "call_zusammenfassung_bei_done";
const ERFOLG = 200;
const SOFORT_MS = 1000;
const OFFEN_MS = 300;
const FRIST_MS = 15000;
const FRIST_UNTERGRENZE_MS = 14500;
const SUMMARY = "Termin am Donnerstag ist vereinbart.";
const SPRECHER = [{ role: "agent", text: "Passt Donnerstag?" }];

const ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
});

async function abholen({ anruf = {}, settings = {}, wartezeitMs = 0 }) {
  const seed = seedState({
    settings,
    calls: [
      seedCall({
        id: ANRUF,
        direction: "outbound",
        status: "completed",
        transcript: SPRECHER,
        ...anruf,
      }),
    ],
  });
  const srv = await startServer({ env: ENV, seed });
  try {
    const start = Date.now();
    const antwort = await abrufMitFrist(
      `${srv.localUrl}/api/calls/${ANRUF}/consult`,
      {},
      { wartezeitMs },
    );
    assert.equal(antwort.status, ERFOLG);
    return { event: (await antwort.json()).event, dauerMs: Date.now() - start };
  } finally {
    await srv.stop();
  }
}

test("zusammenfassung-bei-done: ohne Zusammenfassung meldet done erst nach der Frist", async () => {
  const { event, dauerMs } = await abholen({ wartezeitMs: FRIST_MS });
  assert.equal(event, "done");
  assert.ok(dauerMs >= FRIST_UNTERGRENZE_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: vorhandene Zusammenfassung meldet done sofort", async () => {
  const { event, dauerMs } = await abholen({ anruf: { summary: SUMMARY } });
  assert.equal(event, "done");
  assert.ok(dauerMs < SOFORT_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: fehlgeschlagener Anruf meldet done sofort", async () => {
  const { event, dauerMs } = await abholen({ anruf: { status: "failed" } });
  assert.equal(event, "done");
  assert.ok(dauerMs < SOFORT_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: ohne Transkript meldet done sofort", async () => {
  const { event, dauerMs } = await abholen({ anruf: { transcript: [] } });
  assert.equal(event, "done");
  assert.ok(dauerMs < SOFORT_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: ohne erlaubte Zusammenfassung meldet done sofort", async () => {
  const { event, dauerMs } = await abholen({ settings: { allowSummaries: false } });
  assert.equal(event, "done");
  assert.ok(dauerMs < SOFORT_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: beim Herunterfahren wartet ein offener Abruf nicht auf die Zusammenfassung", async () => {
  const seed = seedState({
    calls: [
      seedCall({ id: ANRUF, direction: "outbound", status: "completed", transcript: SPRECHER }),
    ],
  });
  const srv = await startServer({ env: ENV, seed });
  const abruf = abrufMitFrist(`${srv.localUrl}/api/calls/${ANRUF}/consult`).catch(() => null);
  await echtWarten(OFFEN_MS);
  const start = Date.now();
  await srv.stop();
  await abruf;
  assert.ok(Date.now() - start < FRIST_UNTERGRENZE_MS - SOFORT_MS * 5);
});
