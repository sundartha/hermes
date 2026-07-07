// P5 (tasks/telnyx-p5-spec.md, Check 5(ii)): der per-Call-Bearer (ai_assistant_token) darf
// NIE in die Kunden-Portal-Projektion (portalStore.listCalls) gelangen. In P1 war das Feld
// nie geschrieben (harmlos); ab P5 mintet die Origination es -> jetzt scharf. pglite
// (in-process, kein echter Postgres noetig), Muster test/portal-route.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema, seedDefaults } from "../src/db/migrate.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makePortalStore } from "../src/store/portal.js";

const SECRET_TOKEN = "super-secret-per-call-bearer-do-not-leak";

test("portalStore.listCalls: ai_assistant_token NIE in der Projektion, obwohl in der Zeile gesetzt", async () => {
  const db = new PGlite();
  const q = (t, p) => db.query(t, p);
  await applySchema({ query: q, exec: (s) => db.exec(s) });
  await q(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  await seedDefaults({ query: q, exec: (s) => db.exec(s) }, BOOTSTRAP_TENANT_ID);
  await q(
    `INSERT INTO call
       (id, tenant_id, stream_token, direction, status, started_at, ai_assistant_token,
        call_control_id, assistant_id)
     VALUES ('call_p5', $1, 'tok', 'outbound', 'active', now()::text, $2, 'cc_1', 'asst_1')`,
    [BOOTSTRAP_TENANT_ID, SECRET_TOKEN],
  );

  const runner = { withClient: (fn) => fn({ query: q }) };
  const portalStore = makePortalStore(runner);
  const rows = await portalStore.listCalls(BOOTSTRAP_TENANT_ID);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "call_p5");
  assert.ok(!("ai_assistant_token" in rows[0]), "Spalte NIE in der SELECT-Projektion");
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes(SECRET_TOKEN), "Token-Wert leakt auch nicht ueber ein anderes Feld");
});
