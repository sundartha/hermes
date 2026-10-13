import { test } from "node:test";
import assert from "node:assert/strict";
import { applySchema } from "../src/db/migrate.js";
import { makeAuditStore } from "../src/audit-store.js";
import { neuePGliteInstanz } from "./gemeinsam/pglite-instanz.js";

test("auditStore.record schreibt eine Zeile (keine Secrets im detail)", async () => {
  const db = neuePGliteInstanz();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  const audit = makeAuditStore({ withClient: (fn) => fn({ query: (t, p) => db.query(t, p) }) });
  await audit.record({
    actorSub: "admin1",
    tenantId: "t1",
    action: "tenant_approve",
    detail: "via=admin-endpoint",
  });
  const rows = (await db.query(`SELECT actor_sub, action, tenant_id FROM audit_log`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "tenant_approve");
});
