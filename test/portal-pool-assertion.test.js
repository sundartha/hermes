// F5: Fail-closed Startup-Assertion. Der Kunden-pg-Pool darf NICHT als Superuser
// oder mit BYPASSRLS laufen, sonst ist FORCE-RLS wirkungslos (totaler Tenant-Leak).
// Stub-basiert (TC1-TC5) + PGlite-Rauchtest (TC6) - offline, ohne .env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { assertNoBypassRls } from "../src/portal-pool.js";

// Stub-Client, der die Assertions-SQL mit fest verdrahteten rows beantwortet.
function stubClient(rows) {
  return { query: async () => ({ rows }) };
}

// TC1 - Superuser-Rolle wirft (AC1)
test("assertNoBypassRls: Superuser -> Error mit [F5] + Superuser", async () => {
  const client = stubClient([{ is_su: "on", rolbypassrls: false }]);
  await assert.rejects(() => assertNoBypassRls(client), (e) => {
    assert.match(e.message, /\[F5\]/);
    assert.match(e.message, /superuser/i);
    return true;
  });
});

// TC2 - BYPASSRLS-Rolle wirft (AC2)
test("assertNoBypassRls: BYPASSRLS -> Error mit [F5] + bypassrls", async () => {
  const client = stubClient([{ is_su: "off", rolbypassrls: true }]);
  await assert.rejects(() => assertNoBypassRls(client), (e) => {
    assert.match(e.message, /\[F5\]/);
    assert.match(e.message, /bypassrls/i);
    return true;
  });
});

// TC3 - Normaler non-superuser/NOBYPASSRLS-Pfad kein Fehler (AC3)
test("assertNoBypassRls: non-superuser + NOBYPASSRLS -> kein Fehler", async () => {
  const client = stubClient([{ is_su: "off", rolbypassrls: false }]);
  await assert.doesNotReject(() => assertNoBypassRls(client));
});

// TC4 - Superuser UND BYPASSRLS: Superuser-Fehler gewinnt (Grenzfall)
test("assertNoBypassRls: Superuser + BYPASSRLS -> Superuser-Fehler zuerst", async () => {
  const client = stubClient([{ is_su: "on", rolbypassrls: true }]);
  await assert.rejects(() => assertNoBypassRls(client), /superuser/i);
});

// TC5 - Leeres Ergebnis-Set wirft ebenfalls (fail-closed)
test("assertNoBypassRls: leeres rows -> Error (fail-closed)", async () => {
  const client = stubClient([]);
  await assert.rejects(() => assertNoBypassRls(client));
});

// TC6 - PGlite-Rauchtest: normaler app_user laeuft ohne Fehler (AC3 + AC7)
test("assertNoBypassRls: PGlite NOLOGIN NOBYPASSRLS app_user -> kein Fehler", async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE app_user NOLOGIN NOBYPASSRLS;`);
  await db.query(`SET ROLE app_user`);
  try {
    const client = { query: (t, p) => db.query(t, p) };
    await assert.doesNotReject(() => assertNoBypassRls(client));
  } finally {
    await db.query(`RESET ROLE`);
  }
});
