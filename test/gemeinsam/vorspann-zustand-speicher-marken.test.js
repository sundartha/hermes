import assert from "node:assert/strict";
import test from "node:test";

import { vorspannZustand } from "../../src/store.js";

const TTL_MS = 120_000;
const ANRUF = { tenantId: "t_marken", callId: "call_marken" };
const ANDERER = { tenantId: "t_marken", callId: "call_ohne_zeile" };

const frisch = () => vorspannZustand.anlegen({ ...ANRUF, token: "tok", text: "Satz", ttlMs: TTL_MS });

test("Speicher-Zustand: eine Marke lässt sich nur einmal beanspruchen und liefert den Stand mit allen Marken", async () => {
  await frisch();
  assert.deepEqual(await vorspannZustand.beanspruecheMarke({ ...ANRUF, marke: "EL_BEIN", ms: 5 }), { EL_BEIN: 5 });
  assert.deepEqual(await vorspannZustand.beanspruecheMarke({ ...ANRUF, marke: "WIEDERGABE", ms: 7 }), { EL_BEIN: 5, WIEDERGABE: 7 });
  assert.equal(await vorspannZustand.beanspruecheMarke({ ...ANRUF, marke: "EL_BEIN", ms: 9 }), undefined);
  assert.deepEqual((await vorspannZustand.lade(ANRUF)).stand, { EL_BEIN: 5, WIEDERGABE: 7 });
  assert.equal(await vorspannZustand.beanspruecheMarke({ ...ANDERER, marke: "EL_BEIN", ms: 1 }), undefined);
  await vorspannZustand.loesche(ANRUF);
});

test("Speicher-Zustand: das Entnehmen liefert die Zeile genau einmal und löscht sie", async () => {
  await frisch();
  await vorspannZustand.setzeCallee({ ...ANRUF, calleeId: "cc_eins" });
  assert.deepEqual(await vorspannZustand.entnimm(ANRUF), { calleeId: "cc_eins", token: "tok", text: "Satz", stand: {}, aufgelegt: [], abgehoben: false });
  assert.equal(await vorspannZustand.entnimm(ANRUF), undefined);
  assert.equal(await vorspannZustand.lade(ANRUF), undefined);
  assert.equal(await vorspannZustand.entnimm(ANDERER), undefined);
});
