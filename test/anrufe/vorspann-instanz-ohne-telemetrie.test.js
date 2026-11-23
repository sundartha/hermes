import assert from "node:assert/strict";
import { test } from "node:test";

import { makeVorspannAblauf } from "../../src/elevenlabs/vorspann-ablauf.js";

const CALL = { id: "call_6125", tenantId: "tenant_6125", provider: "telnyx", status: "active" };
const EREIGNIS = { ereignis: "abgehoben", callControlId: "cc_6125" };

const ablaufMit = (config) =>
  makeVorspannAblauf({
    config,
    vorspannZustand: { lade: async () => Promise.reject(new Error("boom")) },
    store: {},
    now: () => 0,
  });

test("6125-A6: Konfiguration ohne telemetry -> Fehlerzeile traegt instanz=-", async (t) => {
  const fehler = t.mock.method(console, "error", () => {});
  await ablaufMit({}).behandle({ call: CALL, ereignis: EREIGNIS });
  assert.deepEqual(fehler.mock.calls.map((aufruf) => aufruf.arguments), [
    ["[el-vorspann] ereignis fehlgeschlagen call=call_6125: boom instanz=-"],
  ]);
});

test("6125-A6: Konfiguration mit telemetry -> Fehlerzeile traegt die Instanzkennung", async (t) => {
  const fehler = t.mock.method(console, "error", () => {});
  await ablaufMit({ telemetry: { telemetryInstanceId: "inst-a6" } }).behandle({ call: CALL, ereignis: EREIGNIS });
  assert.deepEqual(fehler.mock.calls.map((aufruf) => aufruf.arguments), [
    ["[el-vorspann] ereignis fehlgeschlagen call=call_6125: boom instanz=inst-a6"],
  ]);
});
