import { test } from "node:test";
import assert from "node:assert/strict";

import { speicherBereiche } from "../../src/store.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const JETZT_MS = Date.parse("2026-09-01T10:00:00.000Z");
const db = await pgliteAlsRolleOhneSuperuser();

test("Ausfall-SQL: die erste Notiz ohne Versand legt die Zeile mit ausdrücklich leeren Versandfeldern an", async () => {
  const speicher = makePgStoreMitSperre({ withClient: (fn) => fn(db) });
  await speicher.init();

  await speicherBereiche(speicher).ausfall.notizClaimen({
    code: "not-placed:erste-zeile-ohne-versand",
    nowMs: JETZT_MS,
  });

  const { rows } = await db.query(
    "SELECT code, last_attempt_at, reported_at, delivered_channels FROM outage_alert WHERE code = $1",
    ["not-placed:erste-zeile-ohne-versand"],
  );
  assert.deepEqual(rows, [
    {
      code: "not-placed:erste-zeile-ohne-versand",
      last_attempt_at: null,
      reported_at: null,
      delivered_channels: null,
    },
  ]);
});
