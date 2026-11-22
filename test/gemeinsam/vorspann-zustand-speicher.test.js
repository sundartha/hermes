import assert from "node:assert/strict";
import test from "node:test";

import { vorspannZustand } from "../../src/store.js";

const ANRUF = { tenantId: "t_eins", callId: "call_1" };
const TTL_MS = 120_000;

test("Speicher-Zustand: angelegter Text ist je Mandant und Anruf lesbar, bis er geloescht wird", async () => {
  assert.equal(await vorspannZustand.leseText(ANRUF), undefined);
  await vorspannZustand.anlegen({ ...ANRUF, token: "tok", text: "Satz eins", ttlMs: TTL_MS });
  await vorspannZustand.anlegen({ tenantId: "t_zwei", callId: "call_1", token: "tok2", text: "Satz zwei", ttlMs: TTL_MS });
  assert.equal(await vorspannZustand.leseText(ANRUF), "Satz eins");
  assert.equal(await vorspannZustand.leseText({ tenantId: "t_zwei", callId: "call_1" }), "Satz zwei");
  assert.equal(await vorspannZustand.leseText({ tenantId: "t_eins", callId: "call_2" }), undefined);
  await vorspannZustand.loesche(ANRUF);
  assert.equal(await vorspannZustand.leseText(ANRUF), undefined);
  assert.equal(await vorspannZustand.leseText({ tenantId: "t_zwei", callId: "call_1" }), "Satz zwei");
});
