import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../begriffe/nummern.js";
import { PROVISION_NUMBER_JOB } from "../begriffe/nummern-vergabe.js";

const FEHLER = "[pg] nummernkauf fehlgeschlagen:";
const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;
const SPERRE_SQL = `SELECT id FROM tenant WHERE id = $1 FOR UPDATE`;
const LEBENDE_SQL = `SELECT count(*)::int AS anzahl FROM number WHERE tenant_id = $1 AND status <> ALL($2) AND id <> $3`;
const NUMMER_SQL = `INSERT INTO number (id, tenant_id, provider, status, country, language)
  VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`;
const AUFTRAG_SQL = `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, 0, NULL, $7) ON CONFLICT DO NOTHING`;
const AUFTRAG_LESEN_SQL = `SELECT id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at
  FROM provisioning_job WHERE tenant_id = $1 AND idempotency_key = $2`;
const NICHT_ZAEHLEND = [NUMBER_STATUS.RELEASED, NUMBER_STATUS.FAILED];

function alsAuftrag(zeile) {
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

async function unterMandantenSperre(client, tenantId, arbeit) {
  await client.query("BEGIN");
  try {
    await client.query(KONTEXT_SQL, [tenantId]);
    const { rows } = await client.query(SPERRE_SQL, [tenantId]);
    if (rows.length === 0) throw new Error("Mandant nicht in der Datenbank");
    const ergebnis = await arbeit();
    await client.query("COMMIT");
    return ergebnis;
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(FEHLER, fehler.message);
    throw fehler;
  }
}

const nummerEinfuegen = (client, tenantId, number) =>
  client.query(NUMMER_SQL, [
    number.id,
    tenantId,
    number.provider,
    number.status,
    number.country ?? null,
    number.language ?? null,
  ]);

async function nummerAnlegen(client, { tenantId, number, hoechstens }) {
  const { rows } = await client.query(LEBENDE_SQL, [tenantId, NICHT_ZAEHLEND, number.id]);
  if (rows[0].anzahl >= hoechstens) return { ok: false };
  await nummerEinfuegen(client, tenantId, number);
  return { ok: true };
}

async function auftragAnlegen(client, { tenantId, numberId, idempotencyKey, number, jetztIso }) {
  await nummerEinfuegen(client, tenantId, number);
  await client.query(AUFTRAG_SQL, [
    `job_${numberId}`,
    tenantId,
    numberId,
    PROVISION_NUMBER_JOB,
    PROVISIONING_JOB_STATUS.QUEUED,
    idempotencyKey,
    jetztIso,
  ]);
  const { rows } = await client.query(AUFTRAG_LESEN_SQL, [tenantId, idempotencyKey]);
  return alsAuftrag(rows[0]);
}

export function macheNummernSql({ einreihen }) {
  const unterSperre = (tenantId, arbeit) =>
    einreihen((client) => unterMandantenSperre(client, tenantId, () => arbeit(client)));
  return {
    nummerAnlegen: (eingabe) => unterSperre(eingabe.tenantId, (client) => nummerAnlegen(client, eingabe)),
    auftragAnlegen: (eingabe) => unterSperre(eingabe.tenantId, (client) => auftragAnlegen(client, eingabe)),
  };
}
