import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { ENV, ABGELAUFEN, vorFrist } from "./zusammenfassung-bei-done-anruf.js";

const ANRUF = "call_zusammenfassung_bei_done";
const ERFOLG = 200;
const SOFORT_MS = 1000;
const FRIST_MS = 15000;
const FRIST_UNTERGRENZE_MS = 14500;
const SUMMARY = "Termin am Donnerstag ist vereinbart.";
const SPRECHER = [{ role: "agent", text: "Passt Donnerstag?" }];

async function abholen({ anruf = {}, settings = {}, wartezeitMs = 0, grenzeMs = SOFORT_MS }) {
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
    const anfrage = abrufMitFrist(
      `${srv.localUrl}/api/calls/${ANRUF}/consult`,
      {},
      { wartezeitMs },
    ).then(async (antwort) => {
      assert.equal(antwort.status, ERFOLG);
      return (await antwort.json()).event;
    });
    const erste = await vorFrist(grenzeMs, anfrage);
    return { event: await anfrage, vorGrenze: erste !== ABGELAUFEN };
  } finally {
    await srv.stop();
  }
}

test("zusammenfassung-bei-done: ohne Zusammenfassung meldet done erst nach der Frist", async () => {
  const { event, vorGrenze } = await abholen({ wartezeitMs: FRIST_MS, grenzeMs: FRIST_UNTERGRENZE_MS });
  assert.equal(event, "done");
  assert.ok(!vorGrenze, "done vor der Wartefrist");
});

test("zusammenfassung-bei-done: vorhandene Zusammenfassung meldet done sofort", async () => {
  const { event, vorGrenze } = await abholen({ anruf: { summary: SUMMARY } });
  assert.equal(event, "done");
  assert.ok(vorGrenze, "done nicht sofort");
});

test("zusammenfassung-bei-done: fehlgeschlagener Anruf meldet done sofort", async () => {
  const { event, vorGrenze } = await abholen({ anruf: { status: "failed" } });
  assert.equal(event, "done");
  assert.ok(vorGrenze, "done nicht sofort");
});

test("zusammenfassung-bei-done: ohne Transkript meldet done sofort", async () => {
  const { event, vorGrenze } = await abholen({ anruf: { transcript: [] } });
  assert.equal(event, "done");
  assert.ok(vorGrenze, "done nicht sofort");
});

test("zusammenfassung-bei-done: ohne erlaubte Zusammenfassung meldet done sofort", async () => {
  const { event, vorGrenze } = await abholen({ settings: { allowSummaries: false } });
  assert.equal(event, "done");
  assert.ok(vorGrenze, "done nicht sofort");
});

test("zusammenfassung-bei-done: beim Herunterfahren wartet ein offener Abruf nicht auf die Zusammenfassung", async () => {
  const seed = seedState({
    calls: [
      seedCall({ id: ANRUF, direction: "outbound", status: "completed", transcript: SPRECHER }),
    ],
  });
  const srv = await startServer({ env: ENV, seed });
  const abruf = abrufMitFrist(`${srv.localUrl}/api/calls/${ANRUF}/consult`).catch(() => null);
  await abrufMitFrist(`${srv.localUrl}/healthz`);
  const beendet = srv.stop().then(() => abruf);
  const erste = await vorFrist(FRIST_UNTERGRENZE_MS - SOFORT_MS * 5, beendet);
  assert.notEqual(erste, ABGELAUFEN);
  await beendet;
});
