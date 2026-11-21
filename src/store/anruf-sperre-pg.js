import { ANRUF_SPERRE_FRIST_MS, ANRUF_SPERRE_NAMENSRAUM } from "../begriffe/speicher.js";

const FRIST_SQL = `SELECT set_config('lock_timeout', $1, true)`;
const SPERRE_NEHMEN_SQL = `SELECT pg_advisory_lock($1, hashtext($2))`;
const SPERRE_GEBEN_SQL = `SELECT pg_advisory_unlock($1, hashtext($2))`;
const ALLE_GEBEN_SQL = `SELECT pg_advisory_unlock_all()`;

async function alleGeben(client, fehler) {
  let verbleibend;
  console.error("[anruf-sperre] Sperre nicht freigegeben, Verbindungssperren werden aufgehoben:", fehler.message);
  await client.query(ALLE_GEBEN_SQL).catch((zweiter) => {
    verbleibend = zweiter;
    console.error("[anruf-sperre] Sperren der Verbindung nicht aufgehoben, enden mit der Verbindung:", zweiter.message);
  });
  return verbleibend;
}

async function nehmen(client, schluessel) {
  await client.query("BEGIN");
  try {
    await client.query(FRIST_SQL, [String(ANRUF_SPERRE_FRIST_MS)]);
    await client.query(SPERRE_NEHMEN_SQL, schluessel);
    await client.query("COMMIT");
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    await client.query(ALLE_GEBEN_SQL).catch(() => {});
    throw fehler;
  }
}

async function geben(client, schluessel) {
  try {
    await client.query(SPERRE_GEBEN_SQL, schluessel);
  } catch (fehler) {
    return alleGeben(client, fehler);
  }
}

export function mitAnrufSperre(runner, tenantId, arbeit) {
  return runner.halten(async (client, verwerfen) => {
    const schluessel = [ANRUF_SPERRE_NAMENSRAUM, String(tenantId)];
    await nehmen(client, schluessel);
    try {
      return await arbeit();
    } finally {
      const nichtGegeben = await geben(client, schluessel);
      if (nichtGegeben) verwerfen(nichtGegeben);
    }
  });
}
