export const ABLAGE_TABELLE = "webhook_zustellung";

const WARTENDE_AUF_ABLAGE_SQL = `SELECT pid, extract(epoch FROM clock_timestamp() - query_start) * 1000 AS wartet_ms FROM pg_stat_activity
  WHERE wait_event_type = 'Lock' AND query ILIKE '%${ABLAGE_TABELLE}%' AND datname = current_database() AND pid <> pg_backend_pid()`;

export async function wartendeAufAblage(sql) {
  return (await sql(WARTENDE_AUF_ABLAGE_SQL)).rows;
}

const LESUNGEN_MAX = 100;
const LESE_PAUSE_MS = 50;
const ABFRAGE_ZEICHEN_MAX = 80;
const SITZUNGEN_SQL = `SELECT pid, state, wait_event_type, query FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid() ORDER BY pid`;

export async function wartendeBisLesungen(sql, pause) {
  let zeilen = await wartendeAufAblage(sql);
  for (let lesung = 1; zeilen.length < 1 && lesung < LESUNGEN_MAX; lesung += 1) {
    await pause(LESE_PAUSE_MS);
    zeilen = await wartendeAufAblage(sql);
  }
  return zeilen;
}

export function beschreibeSitzungen(zeilen) {
  return zeilen
    .map((z) => `pid=${z.pid} state=${z.state} wait_event_type=${z.wait_event_type} query=${String(z.query).slice(0, ABFRAGE_ZEICHEN_MAX)}`)
    .join("; ");
}

export async function sitzungenBeschrieben(sql) {
  return beschreibeSitzungen((await sql(SITZUNGEN_SQL)).rows);
}
