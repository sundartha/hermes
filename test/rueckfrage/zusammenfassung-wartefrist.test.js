import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";

const ANRUF = "call_zusammenfassung_wartefrist";
const SOFORT_MS = 1000;
const OFFEN_MS = 300;
const FRIST_MS = 15000;
const FRIST_UNTERGRENZE_MS = 14500;
const FRIST_OBERGRENZE_MS = 20000;
const SPRECHER = [{ role: "agent", text: "Passt Donnerstag?" }];
const FRAGEN = ["Passt Donnerstag?"];

const ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
});

const seedMit = (anruf = {}) =>
  seedState({
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

const abruf = (srv, wartezeitMs = 0) =>
  abrufMitFrist(`${srv.localUrl}/api/calls/${ANRUF}/consult`, {}, { wartezeitMs });

test("zusammenfassung-wartefrist: ohne Zusammenfassung meldet der Abruf nach der Wartefrist done und nicht none", async () => {
  const srv = await startServer({ env: ENV, seed: seedMit() });
  try {
    const start = Date.now();
    const antwort = await abruf(srv, FRIST_MS);
    const dauerMs = Date.now() - start;
    assert.equal((await antwort.json()).event, "done");
    assert.ok(dauerMs >= FRIST_UNTERGRENZE_MS, `done nach ${dauerMs} ms`);
    assert.ok(dauerMs < FRIST_OBERGRENZE_MS, `done nach ${dauerMs} ms`);
  } finally {
    await srv.stop();
  }
});

test("zusammenfassung-wartefrist: Herunterfahren beantwortet den wartenden Abruf sofort mit done", async () => {
  const srv = await startServer({ env: ENV, seed: seedMit() });
  const offen = abruf(srv).then(
    async (antwort) => (await antwort.json()).event,
    () => null,
  );
  await echtWarten(OFFEN_MS);
  const start = Date.now();
  await srv.stop();
  const event = await offen;
  assert.ok(Date.now() - start < SOFORT_MS);
  assert.ok(event === "done" || event === null, `Ereignis ${event}`);
  assert.notEqual(event, "none");
});

test("zusammenfassung-wartefrist: eine offene Rueckfrage kommt sofort, auch wenn die Zusammenfassung fehlt", async () => {
  const srv = await startServer({
    env: ENV,
    seed: seedMit({
      consults: [
        {
          id: "c0",
          seq: 0,
          questions: FRAGEN,
          status: "open",
          askedAt: new Date().toISOString(),
          answeredAt: null,
          answeredFacts: 0,
        },
      ],
    }),
  });
  try {
    const start = Date.now();
    const antwort = await abruf(srv);
    const dauerMs = Date.now() - start;
    const koerper = await antwort.json();
    assert.equal(koerper.event, "consult");
    assert.deepEqual(koerper.questions, FRAGEN);
    assert.ok(dauerMs < SOFORT_MS, `Rueckfrage nach ${dauerMs} ms`);
  } finally {
    await srv.stop();
  }
});
