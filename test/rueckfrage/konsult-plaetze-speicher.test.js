import assert from "node:assert/strict";
import test from "node:test";

import { makeKonsultPlaetze } from "../../src/store.js";

const GRENZEN = Object.freeze({ jeAnruf: 2, jeMandant: 4, haltefristMs: 25_000 });
const ANRUF = (callId, tenantId = "tenant_a") => ({ callId, tenantId, ...GRENZEN });

function mitUhr() {
  const uhr = { jetzt: 1_000_000 };
  return { uhr, plaetze: makeKonsultPlaetze({ jetztMs: () => uhr.jetzt }) };
}

test("Je Anruf werden zwei Plaetze vergeben, der dritte wird abgewiesen, andere Anrufe bleiben frei", async () => {
  const { plaetze } = mitUhr();
  assert.notEqual(await plaetze.belegen(ANRUF("c1")), null);
  assert.notEqual(await plaetze.belegen(ANRUF("c1")), null);
  assert.equal(await plaetze.belegen(ANRUF("c1")), null);
  assert.notEqual(await plaetze.belegen(ANRUF("c2")), null);
  assert.equal(plaetze.offenJeAnruf("c1"), 2);
});

test("Je Mandant werden vier Plaetze vergeben, der fuenfte wird abgewiesen, ein anderer Mandant bleibt frei", async () => {
  const { plaetze } = mitUhr();
  for (const callId of ["c1", "c1", "c2", "c2"]) assert.notEqual(await plaetze.belegen(ANRUF(callId)), null);
  assert.equal(await plaetze.belegen(ANRUF("c3")), null);
  assert.notEqual(await plaetze.belegen(ANRUF("c4", "tenant_b")), null);
});

test("Ein freigegebener Platz ist sofort wieder frei, und die Platzkennungen sind verschieden", async () => {
  const { plaetze } = mitUhr();
  const erster = await plaetze.belegen(ANRUF("c1"));
  const zweiter = await plaetze.belegen(ANRUF("c1"));
  assert.notEqual(erster, zweiter);
  assert.equal(await plaetze.belegen(ANRUF("c1")), null);
  await plaetze.freigeben(erster);
  assert.notEqual(await plaetze.belegen(ANRUF("c1")), null);
  assert.equal(plaetze.offenJeAnruf("c1"), 2);
});

test("Ein Platz verfaellt genau mit seiner Haltefrist, eine Millisekunde davor zaehlt er noch", async () => {
  const { uhr, plaetze } = mitUhr();
  await plaetze.belegen(ANRUF("c1"));
  await plaetze.belegen(ANRUF("c1"));
  uhr.jetzt += GRENZEN.haltefristMs - 1;
  assert.equal(await plaetze.belegen(ANRUF("c1")), null);
  uhr.jetzt += 1;
  assert.notEqual(await plaetze.belegen(ANRUF("c1")), null);
  assert.equal(plaetze.offenJeAnruf("c1"), 1);
});
