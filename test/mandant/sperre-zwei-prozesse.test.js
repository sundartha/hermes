import { test } from "node:test";
import assert from "node:assert/strict";
import { mitZweiHermesAufPostgres, postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";
import {
  BOOTSTRAP_TENANT_ID,
  KYC_SETZEN_SQL,
  SPERRE_SETZEN_SQL,
  SPERRE_ZEILE_SQL,
  SUSPENDIEREN_SQL,
  SUSPENDIERT,
  ZAHLUNGSSPERRE,
} from "./sperre-hilfe.js";

test("Kriterium 16: der letzte Flush von B hebt Sperre, Suspendierung und KYC-Stufe nicht auf", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, {}, async ({ b, starte, sql }) => {
    await sql(SPERRE_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, ZAHLUNGSSPERRE]);
    await sql(SUSPENDIEREN_SQL, [BOOTSTRAP_TENANT_ID, SUSPENDIERT]);
    await sql(KYC_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, "none"]);

    await b.stop();
    await starte();

    const { rows } = await sql(SPERRE_ZEILE_SQL, [BOOTSTRAP_TENANT_ID]);
    assert.equal(rows[0].stripe_billing_hold, ZAHLUNGSSPERRE);
    assert.equal(rows[0].status, "suspended");
    assert.equal(rows[0].suspended_at, SUSPENDIERT);
    assert.equal(rows[0].kyc_level, "none");
  });
});
