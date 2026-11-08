export const ABLAGE_TABELLE = "webhook_zustellung";

const WARTENDE_AUF_ABLAGE_SQL = `SELECT pid, extract(epoch FROM clock_timestamp() - query_start) * 1000 AS wartet_ms FROM pg_stat_activity
  WHERE wait_event_type = 'Lock' AND query ILIKE '%${ABLAGE_TABELLE}%' AND datname = current_database() AND pid <> pg_backend_pid()`;

export async function wartendeAufAblage(sql) {
  return (await sql(WARTENDE_AUF_ABLAGE_SQL)).rows;
}
