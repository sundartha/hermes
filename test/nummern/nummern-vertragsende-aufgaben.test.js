import assert from "node:assert/strict";
import { test } from "node:test";

import { tempDataDir } from "../helpers.js";

process.env.DATA_DIR = tempDataDir({
  tenants: [
    { id: "t_nummer", status: "active", numberReleasePending: true },
    { id: "t_workos", status: "active", workosDeletePending: true },
    { id: "t_beides", status: "active", numberReleasePending: true, workosDeletePending: true },
    { id: "t_nichts", status: "active" },
  ],
});

const { tenantsPendingContractEndCleanup } = await import("../../src/store.js");

test("tenantsPendingContractEndCleanup: nennt jeden Mandanten mit offener Nummern- oder WorkOS-Aufgabe, sonst keinen", () => {
  const ids = tenantsPendingContractEndCleanup().map((tenant) => tenant.id);
  assert.deepEqual(ids.sort(), ["t_beides", "t_nummer", "t_workos"]);
});
