import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, makePgTestStore } from "../pg-helpers.js";

const NUMMER_ZWEI = 2;
const VERSIONSTABELLE_ANLEGEN = "CREATE TABLE IF NOT EXISTS schema_migrations";
const URSACHE = "Fehlerursache aus der Datenbank";

test("scheitert eine Migration, trägt der Abbruch die ursprüngliche Datenbankmeldung als Ursache", async () => {
  const { db } = await makePgTestStore();
  await db.query("DELETE FROM schema_migrations WHERE version = $1", [NUMMER_ZWEI]);
  const runner = {
    withClient: (arbeit) =>
      arbeit({
        query: (text, params) => db.query(text, params),
        exec: (sql) =>
          sql.includes(VERSIONSTABELLE_ANLEGEN)
            ? Promise.reject(new Error(URSACHE))
            : db.exec(sql),
      }),
  };

  const fehler = await makePgStore(runner)
    .init()
    .then(
      () => null,
      (err) => err,
    );

  assert.ok(fehler instanceof Error);
  assert.equal(fehler.cause?.message, URSACHE);
});
