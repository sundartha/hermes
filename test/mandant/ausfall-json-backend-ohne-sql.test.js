import assert from "node:assert/strict";
import { test } from "node:test";

import { ausfallSql, speicherBereiche } from "../../src/store.js";

test("ausfall-json-backend-ohne-sql: das JSON-Backend meldet ausdrücklich keinen SQL-Zugang", () => {
  assert.strictEqual(ausfallSql(), null);
});

test("ausfall-json-backend-ohne-sql: ein Claim auf dem JSON-Backend legt einen Marker an, den der Bereich zurückgibt", async () => {
  const bereich = speicherBereiche(await import("../../src/store.js")).ausfall;
  const code = "not-placed:json-ohne-sql";

  await bereich.notizClaimen({ code, nowMs: Date.parse("2026-09-01T10:00:00.000Z") });

  const marker = await bereich.offenerMarker({ code });
  assert.equal(marker.code, code);
  assert.equal(marker.firstSeenAt, "2026-09-01T10:00:00.000Z");
});
