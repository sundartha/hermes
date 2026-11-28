import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, seedState, OWNER_TEST_NUMBER, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const SEKUNDE_MS = 1000;
const SPIELRAUM_MS = 15 * SEKUNDE_MS;

test("Eingehender Anruf: die Hoechstdauer-Frist steht an der Anrufzeile, genau eine Hoechstdauer nach dem Start", async (t) => {
  const srv = await startServer({ seed: seedState() });
  t.after(() => srv.stop());
  await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    body: new URLSearchParams({ CallSid: "CAfrist1", From: "+15005550101", To: OWNER_TEST_NUMBER.e164 }),
  });
  const aktiv = () => srv.readStore().calls.find((anruf) => anruf.status === "active");
  await waitUntil(() => aktiv()?.fristHoechstdauerAt);
  const call = aktiv();
  assert.ok(call.maxDurationS > 0);
  const frist = Date.parse(call.fristHoechstdauerAt);
  const erwartetMin = Date.parse(call.startedAt) + call.maxDurationS * SEKUNDE_MS;
  assert.ok(frist >= erwartetMin, `frist ${call.fristHoechstdauerAt} vor ${new Date(erwartetMin).toISOString()}`);
  assert.ok(frist <= erwartetMin + SPIELRAUM_MS, `frist ${call.fristHoechstdauerAt} zu spaet`);
});
