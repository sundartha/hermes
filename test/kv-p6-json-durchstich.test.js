// KV-P6 (json-Durchstich): cost_micro_cents ist additiv im json-Backend - src/store/json.js
// selbst braucht KEINEN Code-Edit (recordUsageEvent(input) reicht das komplette
// ops.recordUsageEvent(...)-Ergebnisobjekt unveraendert an save() durch), aber diese Datei
// beweist es empirisch: der Wert muss tatsaechlich auf der Platte landen (data/store.json-
// Aequivalent im Test-DATA_DIR), nicht nur im In-Memory-Zustand ueberleben.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";

let store;

before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
  );
  store = await import("../src/store.js");
});

test("KV-P6-6 (json): cost_micro_cents landet auf der Platte in store.json", () => {
  store.recordUsageEvent({
    tenantId: BOOTSTRAP_TENANT_ID,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: 10,
    costCents: 0,
    costMicroCents: 465000,
  });
  const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "store.json"), "utf8"));
  const ev = onDisk.usageEvents.find((e) => e.kind === USAGE_EVENT_KIND.AI_TOKEN);
  assert.equal(
    ev.costMicroCents,
    465000,
    "das json-Backend ist schemalos - der Wert muss trotzdem tatsaechlich auf der Platte landen",
  );
});
