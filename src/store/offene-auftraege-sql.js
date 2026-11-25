import { PROVISIONING_JOB_STATUS } from "../begriffe/nummern.js";

export const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;
export const AUFTRAG_SPALTEN = "id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at, instanz";
const MANDANTEN_SQL = `SELECT DISTINCT tenant_id FROM offener_auftrag_schluessel ORDER BY tenant_id`;
const OFFENE_SQL = `SELECT ${AUFTRAG_SPALTEN} FROM provisioning_job WHERE tenant_id = $1 AND status = $2 ORDER BY id`;
const NUMMERN_ZU_AUFTRAEGEN_SQL = `SELECT * FROM number WHERE tenant_id = $1 AND id = ANY($2)`;

export function alsAuftrag(zeile) {
  return {
    id: zeile.id,
    tenantId: zeile.tenant_id,
    numberId: zeile.number_id,
    kind: zeile.kind,
    status: zeile.status,
    idempotencyKey: zeile.idempotency_key,
    attempts: zeile.attempts,
    lastError: zeile.last_error ?? null,
    createdAt: zeile.created_at instanceof Date ? zeile.created_at.toISOString() : zeile.created_at,
  };
}

export async function offeneLesen(client, zeileZuNummer) {
  const { rows: mandanten } = await client.query(MANDANTEN_SQL);
  const gefunden = [];
  for (const { tenant_id: id } of mandanten) {
    await client.query("BEGIN");
    try {
      await client.query(KONTEXT_SQL, [id]);
      const { rows } = await client.query(OFFENE_SQL, [id, PROVISIONING_JOB_STATUS.QUEUED]);
      const nummern = rows.length
        ? (await client.query(NUMMERN_ZU_AUFTRAEGEN_SQL, [id, rows.map((zeile) => zeile.number_id)])).rows
        : [];
      await client.query("COMMIT");
      for (const zeile of rows) {
        const nummer = nummern.find((eine) => eine.id === zeile.number_id);
        gefunden.push({ job: alsAuftrag(zeile), nummer: nummer ? zeileZuNummer(nummer) : null, instanz: zeile.instanz ?? null });
      }
    } catch (fehler) {
      await client.query("ROLLBACK").catch(() => {});
      throw fehler;
    }
  }
  return gefunden;
}
