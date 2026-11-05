import { makePortalStore } from "./portal.js";

const BESTAETIGUNG_ANWEISUNGSFRIST_MS = 1000;

function usedCodesFor(client, tenantId) {
  return {
    async wasUsed({ digest, nowMs }) {
      const { rows } = await client.query(
        `SELECT 1 FROM bestaetigung_verbrauch WHERE tenant_id = $1 AND digest = $2 AND expires_at > $3`,
        [tenantId, digest, nowMs],
      );
      return rows.length > 0;
    },
    async markIfUnused({ digest, acceptedUntilMs }) {
      const { rows } = await client.query(
        `INSERT INTO bestaetigung_verbrauch (tenant_id, digest, expires_at) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, digest) DO NOTHING RETURNING digest`,
        [tenantId, digest, acceptedUntilMs],
      );
      return rows.length > 0;
    },
  };
}

function freshSlotsFor(client, tenantId) {
  return {
    async currentSlot({ digest, nowMs }) {
      const { rows } = await client.query(
        `SELECT slot FROM bestaetigung_slot WHERE tenant_id = $1 AND digest = $2 AND expires_at > $3`,
        [tenantId, digest, nowMs],
      );
      return Number(rows[0]?.slot ?? 0);
    },
    async advance({ digest, acceptedUntilMs }) {
      await client.query(
        `INSERT INTO bestaetigung_slot (tenant_id, digest, slot, expires_at) VALUES ($1, $2, 1, $3)
         ON CONFLICT (tenant_id, digest)
         DO UPDATE SET slot = bestaetigung_slot.slot + 1, expires_at = EXCLUDED.expires_at`,
        [tenantId, digest, acceptedUntilMs],
      );
    },
  };
}

function failedAttemptsFor(client, tenantId) {
  return {
    async failureCount({ windowIdx, nowMs }) {
      const { rows } = await client.query(
        `SELECT count FROM bestaetigung_fehlversuch
          WHERE tenant_id = $1 AND window_idx = $2 AND expires_at > $3`,
        [tenantId, windowIdx, nowMs],
      );
      return Number(rows[0]?.count ?? 0);
    },
    async recordFailure({ windowIdx, windowEndMs }) {
      await client.query(
        `INSERT INTO bestaetigung_fehlversuch (tenant_id, window_idx, count, expires_at)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (tenant_id, window_idx)
         DO UPDATE SET count = bestaetigung_fehlversuch.count + 1`,
        [tenantId, windowIdx, windowEndMs],
      );
    },
  };
}

async function deleteExpired(client, tenantId, nowMs) {
  const params = [tenantId, nowMs];
  await client.query(
    `DELETE FROM bestaetigung_verbrauch WHERE tenant_id = $1 AND expires_at <= $2`,
    params,
  );
  await client.query(
    `DELETE FROM bestaetigung_slot WHERE tenant_id = $1 AND expires_at <= $2`,
    params,
  );
  await client.query(
    `DELETE FROM bestaetigung_fehlversuch WHERE tenant_id = $1 AND expires_at <= $2`,
    params,
  );
}

export function makeBestaetigungsRegister(runner) {
  const { withTenant } = makePortalStore(runner);
  return {
    transaktion: ({ tenantId, nowMs, arbeit }) =>
      withTenant(
        tenantId,
        async (client) => {
          await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
            `bestaetigungscodes|${tenantId}`,
          ]);
          await deleteExpired(client, tenantId, nowMs);
          return arbeit({
            usedCodes: usedCodesFor(client, tenantId),
            freshSlots: freshSlotsFor(client, tenantId),
            failedAttempts: failedAttemptsFor(client, tenantId),
          });
        },
        { statementTimeoutMs: BESTAETIGUNG_ANWEISUNGSFRIST_MS },
      ),
  };
}
