import assert from "node:assert/strict";
import { test } from "node:test";

import { mitEndendemAnruf, vorFrist, ABGELAUFEN, MCP_SUMMARY, HALTEZEIT_MS, GATEWAY_ABBRUCH_MS, FRIST_REST_MS } from "./zusammenfassung-bei-done-anruf.js";

test("zusammenfassung-bei-done: await_call_event antwortet nie nach der Haltezeit und meldet beim naechsten Abruf done mit Zusammenfassung", async () => {
  await mitEndendemAnruf({}, async ({ abfrage, beendeAnruf, gibUrteilFrei }) => {
    const ersteAbfrage = abfrage();
    const erste = await vorFrist(HALTEZEIT_MS + FRIST_REST_MS, ersteAbfrage);
    assert.notEqual(erste, ABGELAUFEN, "Abfrage dauerte laenger als die Haltezeit");
    assert.notEqual(await vorFrist(GATEWAY_ABBRUCH_MS - FRIST_REST_MS * 2, ersteAbfrage), ABGELAUFEN);
    assert.equal(erste.data.event, "none");
    await beendeAnruf();
    const offen = abfrage();
    await gibUrteilFrei();
    const zweite = await offen;
    assert.equal(zweite.data.event, "done");
    assert.equal(zweite.data.result_summary, MCP_SUMMARY);
  });
});
