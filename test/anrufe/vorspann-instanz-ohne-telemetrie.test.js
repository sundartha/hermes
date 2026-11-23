import assert from "node:assert/strict";
import { test } from "node:test";

import { meldeVorspannRueckfall, setzeInstanzKennung } from "../../src/elevenlabs/vorspann-erzeugen.js";

const zeileMit = (t, config) => {
  const log = t.mock.method(console, "log", () => {});
  setzeInstanzKennung(config);
  meldeVorspannRueckfall({ callId: "call_6125", grund: "tts_quote" });
  return log.mock.calls.map((aufruf) => aufruf.arguments);
};

test("6125-A6: Konfiguration ohne telemetry -> Logzeile traegt instanz=-", (t) => {
  assert.deepEqual(zeileMit(t, {}), [["[el-vorspann] rueckfall grund=tts_quote call=call_6125 instanz=-"]]);
});

test("6125-A6: Konfiguration mit telemetry -> Logzeile traegt die Instanzkennung", (t) => {
  assert.deepEqual(zeileMit(t, { telemetry: { telemetryInstanceId: "inst-a6" } }), [
    ["[el-vorspann] rueckfall grund=tts_quote call=call_6125 instanz=inst-a6"],
  ]);
});
