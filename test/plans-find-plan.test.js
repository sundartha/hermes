import { test } from "node:test";
import assert from "node:assert/strict";
import { findPlan } from "../src/plans.js";

test("S3: findPlan(bekannt) -> Katalog-Objekt", () => {
  assert.equal(findPlan("starter")?.slug, "starter");
  assert.equal(findPlan("business")?.slug, "business");
});

test("S3: findPlan(unbekannt/leer/undefined) -> null (Null-Zweig)", () => {
  assert.equal(findPlan("nope"), null);
  assert.equal(findPlan(""), null);
  assert.equal(findPlan(undefined), null);
});
