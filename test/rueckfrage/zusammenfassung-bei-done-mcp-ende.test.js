import assert from "node:assert/strict";
import { test } from "node:test";

import { mitEndendemAnruf, MCP_SUMMARY, LANGSAMER_START_MS } from "./zusammenfassung-bei-done-anruf.js";

test("zusammenfassung-bei-done: await_call_event meldet done mit der Zusammenfassung, die nach dem Anrufende waehrend der Abfrage eintrifft", async () => {
  await mitEndendemAnruf({}, async ({ abfrage, beendeAnruf, gibUrteilFrei }) => {
    await beendeAnruf();
    const offen = abfrage();
    await gibUrteilFrei();
    const { data } = await offen;
    assert.equal(data.event, "done");
    assert.equal(data.result_summary, MCP_SUMMARY);
  });
});

test("zusammenfassung-bei-done: await_call_event meldet done mit der Zusammenfassung auch bei langsamem Serverstart", async () => {
  await mitEndendemAnruf({ startVerzoegerungMs: LANGSAMER_START_MS }, async ({ abfrage, beendeAnruf, gibUrteilFrei }) => {
    await beendeAnruf();
    const offen = abfrage();
    await gibUrteilFrei();
    const { data } = await offen;
    assert.equal(data.event, "done");
    assert.equal(data.result_summary, MCP_SUMMARY);
  });
});
