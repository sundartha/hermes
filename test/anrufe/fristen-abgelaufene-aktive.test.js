import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallLifecycle } from "../../src/telephony/call-lifecycle.ts";
import { classifyCallTime } from "../../src/store/state-ops.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const MINUTE_MS = 60_000;
const MAX_DAUER_S = 60;

function anruf(id, status, answeredVorMs, jetzt) {
  return {
    id,
    status,
    maxDurationS: MAX_DAUER_S,
    answeredAt: new Date(jetzt - answeredVorMs).toISOString(),
  };
}

test("abgelaufeneAktive nennt nur aktive Anrufe, deren Hoechstdauer vorbei ist", () => {
  const jetzt = Date.now();
  const calls = [
    anruf("abgelaufen", "active", 2 * MINUTE_MS, jetzt),
    anruf("laeuft_noch", "active", 1000, jetzt),
    anruf("schon_beendet", "completed", 2 * MINUTE_MS, jetzt),
  ];
  const lifecycle = makeCallLifecycle({
    store: { load: () => ({ calls }) },
    config: withConfigNamespaces({}),
    classifyCallTime,
  });
  assert.deepEqual(lifecycle.abgelaufeneAktive().map((call) => call.id), ["abgelaufen"]);
});
