import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { assertNoBypassRls, createPortalRunner } from "../src/portal-pool.js";

function stubClient(rows) {
  return { query: async () => ({ rows }) };
}

test("assertNoBypassRls: Superuser -> Error mit [F5] + Superuser", async () => {
  const client = stubClient([{ is_su: "on", rolbypassrls: false }]);
  await assert.rejects(
    () => assertNoBypassRls(client),
    (e) => {
      assert.match(e.message, /\[F5\]/);
      assert.match(e.message, /superuser/i);
      return true;
    },
  );
});

test("assertNoBypassRls: BYPASSRLS -> Error mit [F5] + bypassrls", async () => {
  const client = stubClient([{ is_su: "off", rolbypassrls: true }]);
  await assert.rejects(
    () => assertNoBypassRls(client),
    (e) => {
      assert.match(e.message, /\[F5\]/);
      assert.match(e.message, /bypassrls/i);
      return true;
    },
  );
});

test("assertNoBypassRls: non-superuser + NOBYPASSRLS -> kein Fehler", async () => {
  const client = stubClient([{ is_su: "off", rolbypassrls: false }]);
  await assert.doesNotReject(() => assertNoBypassRls(client));
});

test("assertNoBypassRls: Superuser + BYPASSRLS -> Superuser-Fehler zuerst", async () => {
  const client = stubClient([{ is_su: "on", rolbypassrls: true }]);
  await assert.rejects(() => assertNoBypassRls(client), /superuser/i);
});

test("assertNoBypassRls: leeres rows -> Error (fail-closed)", async () => {
  const client = stubClient([]);
  await assert.rejects(() => assertNoBypassRls(client));
});

test("T-P0-04: createPortalRunner connect-Fehler -> pool.end + throw (kein Pool-Leak)", async () => {
  let ended = false;
  const fakePool = {
    connect: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    },
    end: async () => {
      ended = true;
    },
  };
  await assert.rejects(() => createPortalRunner({ pool: fakePool }), /ECONNREFUSED/);
  assert.equal(ended, true, "pool.end muss laufen, sonst leakt der Pool");
});

test("T-P0-04b: createPortalRunner Superuser-Assertion -> client.release + pool.end + throw", async () => {
  let released = false;
  let ended = false;
  const client = {
    query: async () => ({ rows: [{ is_su: "on", rolbypassrls: false }] }),
    release: () => {
      released = true;
    },
  };
  const fakePool = {
    connect: async () => client,
    end: async () => {
      ended = true;
    },
  };
  await assert.rejects(() => createPortalRunner({ pool: fakePool }), /\[F5\]/);
  assert.equal(released, true, "client.release muss laufen");
  assert.equal(ended, true, "pool.end muss laufen");
});

function makeFakePool() {
  let connectCount = 0;
  let workReleased = 0;
  const roleClient = {
    query: async () => ({ rows: [{ is_su: "off", rolbypassrls: false }] }),
    release: () => {},
  };
  const workClient = {
    query: async () => ({ rows: [] }),
    release: () => {
      workReleased += 1;
    },
  };
  const pool = {
    connect: async () => {
      connectCount += 1;
      return connectCount === 1 ? roleClient : workClient;
    },
    end: async () => {},
  };
  return { pool, workReleasedCount: () => workReleased };
}

test("S1-13a: withClient gibt den Rueckgabewert von fn durch UND released den Work-Client", async () => {
  const { pool, workReleasedCount } = makeFakePool();
  const runner = await createPortalRunner({ pool });
  const out = await runner.withClient(async () => "SENTINEL");
  assert.equal(out, "SENTINEL", "withClient muss await fn(...) zurueckgeben");
  assert.equal(workReleasedCount(), 1);
});

test("S1-13b: withClient released den Work-Client auch wenn fn wirft (finally-Garantie)", async () => {
  const { pool, workReleasedCount } = makeFakePool();
  const runner = await createPortalRunner({ pool });
  await assert.rejects(
    () =>
      runner.withClient(async () => {
        throw new Error("boom-in-fn");
      }),
    /boom-in-fn/,
  );
  assert.equal(workReleasedCount(), 1, "Work-Client muss trotz Wurf released werden");
});

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
