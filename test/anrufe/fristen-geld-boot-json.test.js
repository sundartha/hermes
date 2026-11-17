import { test } from "node:test";
import assert from "node:assert/strict";
import { waitUntil } from "../helpers.js";
import { geldBootJsonStarten } from "./geld-boot-json-aufbau.mjs";

const FRIST_BIS_BEENDET_MS = 10_000;
const BUDGET_FAILURE_REASON = "budget-exhausted";

const { store, aufgelegt, aktiverAnruf } = await geldBootJsonStarten({});

test("Kriterium 3: im JSON-Speicher beendet der Boot-Takt einen aktiven Anruf ohne Timer, dessen Mandant die Kostendecke erreicht hat, mit Budget-Grund, abgerechnet und einmal aufgelegt", async () => {
  const id = aktiverAnruf("decke", { hoechstdauerInMinuten: 60 });
  await waitUntil(() => store.getCall(id)?.status === "completed", { timeoutMs: FRIST_BIS_BEENDET_MS });
  await store.drainFlushes();
  const ende = store.getCall(id);
  assert.equal(ende.failureReason, BUDGET_FAILURE_REASON);
  assert.notEqual(ende.billedAt, null);
  assert.deepEqual(aufgelegt, ["CA_geld_boot_json_decke"]);
});
