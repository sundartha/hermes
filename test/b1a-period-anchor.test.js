import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantSubscription,
  tenantSubscription,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const A = "tenant_a";
const START = 1690000000;
const SUB = "sub_b1a";

let jsonBackend;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  jsonBackend = await import("../src/store/json.js");
});

test("selektiver Patch: currentPeriodStart setzen; Folge-Patch (subscriptionId) laesst den Start unberuehrt", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setTenantSubscription(s, A, { currentPeriodStart: START });
  assert.equal(tenantSubscription(s, A).currentPeriodStart, START, "Start gesetzt");
  setTenantSubscription(s, A, { subscriptionId: SUB });
  const sub = tenantSubscription(s, A);
  assert.equal(sub.subscriptionId, SUB, "subscriptionId gesetzt");
  assert.equal(sub.currentPeriodStart, START, "Start vom Folge-Patch unberuehrt");
});

test("tenantSubscription: Tenant ohne Anker -> currentPeriodStart === null (nie undefined)", () => {
  const s = makeDefaultState();
  assert.equal(tenantSubscription(s, BOOTSTRAP_TENANT_ID).currentPeriodStart, null);
});

test("json-Round-Trip: setTenantSubscription via Fassade persistiert -> tenantSubscription liest currentPeriodStart", () => {
  jsonBackend.setTenantSubscription(BOOTSTRAP_TENANT_ID, {
    subscriptionId: SUB,
    planSlug: "starter",
    currentPeriodEnd: 1893456000,
    currentPeriodStart: START,
  });
  assert.equal(jsonBackend.tenantSubscription(BOOTSTRAP_TENANT_ID).currentPeriodStart, START);
});
