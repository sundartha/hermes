import { test } from "node:test";
import assert from "node:assert/strict";
import { mitZweiHermesAufPostgres, postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const ZAHLUNGSSPERRE = "paused";
const SUSPENDIERT = "2026-01-01T00:00:00.000Z";
const SPERRE_ZEILE_SQL = `SELECT status, kyc_level, suspended_at, stripe_billing_hold FROM tenant WHERE id = $1`;
const SPERRE_SETZEN_SQL = `UPDATE tenant SET stripe_billing_hold = $2 WHERE id = $1`;
const SUSPENDIEREN_SQL = `UPDATE tenant SET status = 'suspended', suspended_at = $2 WHERE id = $1`;
const KYC_SETZEN_SQL = `UPDATE tenant SET kyc_level = $2 WHERE id = $1`;

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
