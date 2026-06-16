// F5: Fail-closed Startup-Assertion. Der Kunden-pg-Pool darf NICHT als Superuser
// oder mit BYPASSRLS laufen, sonst ist FORCE-RLS wirkungslos (totaler Tenant-Leak).
// Stub-basiert (TC1-TC5) + PGlite-Rauchtest (TC6) - offline, ohne .env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { assertNoBypassRls, createPortalRunner } from "../src/portal-pool.js";

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

// T-P0-04 (AC7) - connect()-Fehler: Pool wird beendet (kein Leak), Fehler propagiert.
// Pool via DI injiziert (Default-Pfad no-arg unveraendert): connect() liegt jetzt IM
// try, der catch ruft pool.end() bevor er den Fehler weiterreicht.
test("T-P0-04: createPortalRunner connect-Fehler -> pool.end + throw (kein Pool-Leak)", async () => {
  let ended = false;
  const fakePool = {
    connect: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:1"); },
    end: async () => { ended = true; },
  };
  await assert.rejects(() => createPortalRunner({ pool: fakePool }), /ECONNREFUSED/);
  assert.equal(ended, true, "pool.end muss laufen, sonst leakt der Pool");
});

// T-P0-04b (AC7 + F5) - Assertion-Fehler nach erfolgreichem connect: client.release
// UND pool.end laufen, Fehler propagiert. Das ist die reale Boot-Fault (Superuser-
// DATABASE_URL) - in T-P0-05 als Decoupling-Quelle wiederverwendet.
test("T-P0-04b: createPortalRunner Superuser-Assertion -> client.release + pool.end + throw", async () => {
  let released = false;
  let ended = false;
  const client = {
    query: async () => ({ rows: [{ is_su: "on", rolbypassrls: false }] }),
    release: () => { released = true; },
  };
  const fakePool = { connect: async () => client, end: async () => { ended = true; } };
  await assert.rejects(() => createPortalRunner({ pool: fakePool }), /\[F5\]/);
  assert.equal(released, true, "client.release muss laufen");
  assert.equal(ended, true, "pool.end muss laufen");
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
