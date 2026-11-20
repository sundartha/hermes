import assert from "node:assert/strict";
import { test } from "node:test";

import {
  makeDefaultState,
  registerTenant,
  setContractEndCleanupPending,
  tenantsPendingContractEndCleanup,
} from "../../src/store/state-ops.js";

test("tenantsPendingContractEndCleanup: nennt jeden Mandanten mit offener Nummern- oder WorkOS-Aufgabe, sonst keinen", () => {
  const s = makeDefaultState();
  for (const id of ["t_nummer", "t_workos", "t_beides", "t_nichts"]) registerTenant(s, id);
  setContractEndCleanupPending(s, "t_nummer", { numberReleasePending: true });
  setContractEndCleanupPending(s, "t_workos", { workosDeletePending: true });
  setContractEndCleanupPending(s, "t_beides", { numberReleasePending: true, workosDeletePending: true });
  const ids = tenantsPendingContractEndCleanup(s).map((tenant) => tenant.id);
  assert.deepEqual(ids.sort(), ["t_beides", "t_nummer", "t_workos"]);
});
