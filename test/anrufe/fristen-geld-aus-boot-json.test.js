import { test } from "node:test";
import assert from "node:assert/strict";
import { waitUntil } from "../helpers.js";
import { geldBootJsonStarten } from "./geld-boot-json-aufbau.mjs";

const FRIST_BIS_BEENDET_MS = 10_000;

const { store, aktiverAnruf } = await geldBootJsonStarten({ BUDGET_WATCHDOG_INTERVAL_MS: "0" });

test("Kriterium 3: ist die Geld-Wache abgeschaltet (BUDGET_WATCHDOG_INTERVAL_MS=0), beendet der Boot-Takt keinen Anruf wegen der Kostendecke, die Hoechstdauer gilt weiter", async () => {
  const ueberDecke = aktiverAnruf("aus", { hoechstdauerInMinuten: 60 });
  const abgelaufen = aktiverAnruf("abgelaufen", { hoechstdauerInMinuten: -1 });
  await waitUntil(() => store.getCall(abgelaufen)?.status === "completed", { timeoutMs: FRIST_BIS_BEENDET_MS });
  const spaeter = aktiverAnruf("spaeter", { hoechstdauerInMinuten: -1 });
  await waitUntil(() => store.getCall(spaeter)?.status === "completed", { timeoutMs: FRIST_BIS_BEENDET_MS });
  assert.equal(store.getCall(ueberDecke).status, "active");
  assert.equal(store.getCall(ueberDecke).failureReason, null);
  const geholt = await store.faelligeFristen({ art: "geld", limitJeMandant: 10, leaseMs: 1000 });
  assert.equal(geholt.find((treffer) => treffer.callId === ueberDecke)?.versuche, 1);
});
