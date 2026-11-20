import { test } from "node:test";
import assert from "node:assert/strict";

import { speicherBereiche } from "../../src/store.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const JETZT_MS = Date.parse("2026-09-01T10:00:00.000Z");
const db = await pgliteAlsRolleOhneSuperuser();

test("Ausfall-SQL: die erste Notiz ohne Versand legt die Zeile mit ausdrücklich leeren Versandfeldern an", async () => {
  const protokoll = [];
  const client = {
    query: async (text, params) => {
      protokoll.push({ text, params });
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  const speicher = makePgStoreMitSperre({ withClient: (fn) => fn(client) });
  await speicher.init();
  protokoll.length = 0;

  await speicherBereiche(speicher).ausfall.notizClaimen({
    code: "not-placed:erste-zeile-ohne-versand",
    nowMs: JETZT_MS,
  });

  const anlegen = protokoll.find((eintrag) => /^INSERT INTO outage_alert/.test(eintrag.text));
  assert.deepEqual(anlegen.params.slice(3), [null, null, null]);
});
