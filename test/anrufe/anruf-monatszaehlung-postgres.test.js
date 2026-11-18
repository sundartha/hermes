import assert from "node:assert/strict";
import test from "node:test";

import { mandantenAbruf, mitHermesAufPostgresMitMandanten, postgresVorhanden } from "./hermes-mit-postgres.js";

const MANDANT_A = Object.freeze({ id: "tenant_mon_a", sub: "sub-mon-a", e164: "+4930555000301" });
const MANDANT_B = Object.freeze({ id: "tenant_mon_b", sub: "sub-mon-b", e164: "+4930555000302" });
const ANRUFE_A_DIESEN_MONAT = 35;
const ANRUFE_B_DIESEN_MONAT = 2;
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', 'completed', $4, $5, 'Testziel', $6, 600, 'telnyx')`;

function monatsanfang() {
  const jetzt = new Date();
  return new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), 1));
}

async function legeAn(sql, mandant, id, startIso) {
  await sql(ANRUF_SQL, [id, mandant.id, `tok_${id}`, mandant.e164, "+4915112345678", startIso]);
}

test("MONATSZAEHLUNG-SQL: usage.callsThisMonth zaehlt alle Anrufe des Mandanten seit Monatsbeginn UTC, ohne Vormonat und ohne fremden Mandanten, auch ueber die 30 der Liste hinaus", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitHermesAufPostgresMitMandanten(t, { mandanten: [MANDANT_A, MANDANT_B] }, async ({ srv, sql }) => {
    const anfang = monatsanfang().getTime();
    for (let i = 0; i < ANRUFE_A_DIESEN_MONAT; i += 1) {
      await legeAn(sql, MANDANT_A, `call_mon_a_${i}`, new Date(anfang + i * 1000).toISOString());
    }
    await legeAn(sql, MANDANT_A, "call_mon_a_vormonat", new Date(anfang - 1).toISOString());
    for (let i = 0; i < ANRUFE_B_DIESEN_MONAT; i += 1) {
      await legeAn(sql, MANDANT_B, `call_mon_b_${i}`, new Date(anfang + i * 1000).toISOString());
    }
    const zustand = async (mandant) => (await mandantenAbruf(srv, mandant.sub).hole("/api/state")).json();
    assert.equal((await zustand(MANDANT_A)).usage.callsThisMonth, ANRUFE_A_DIESEN_MONAT);
    assert.equal((await zustand(MANDANT_B)).usage.callsThisMonth, ANRUFE_B_DIESEN_MONAT);
  });
});
