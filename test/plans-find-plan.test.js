// S3 (P8-Testluecke): findPlan() - bisher nur indirekt ueber bekannte Slugs genutzt
// (b2-quota-gate.test.js, telnyx-p5-gate-proof.test.js). Deckt hier zusaetzlich den
// bisher ungetesteten Null-Zweig (?? null bei unbekanntem/leerem/undefined Slug, G3/T5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findPlan } from "../src/plans.js";

test("S3: findPlan(bekannt) -> Katalog-Objekt", () => {
  assert.equal(findPlan("starter")?.slug, "starter");
  assert.equal(findPlan("pro")?.slug, "pro");
});

test("S3: findPlan(unbekannt/leer/undefined) -> null (Null-Zweig)", () => {
  assert.equal(findPlan("nope"), null);
  assert.equal(findPlan(""), null);
  assert.equal(findPlan(undefined), null);
});
