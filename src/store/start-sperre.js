import { START_SPERRE_NAMENSRAUM } from "../begriffe/speicher.js";

const SPERRE_NEHMEN_SQL = `SELECT pg_try_advisory_lock($1, $2) AS erhalten`;
const SPERRE_GEBEN_SQL = `SELECT pg_advisory_unlock($1, $2)`;
const MANDANT_SETZEN_SQL = `SELECT set_config('app.current_tenant', $1, true)`;

export function mitStartSperre(runner, routine, arbeit) {
  return runner.withClient(async (client) => {
    const schluessel = [START_SPERRE_NAMENSRAUM, routine];
    const { rows } = await client.query(SPERRE_NEHMEN_SQL, schluessel);
    if (!rows[0].erhalten) return { uebersprungen: true };
    try {
      return { uebersprungen: false, ergebnis: await arbeit() };
    } finally {
      await client.query(SPERRE_GEBEN_SQL, schluessel);
    }
  });
}

async function mandantHatNummer(client, mandantId) {
  await client.query("BEGIN");
  try {
    await client.query(MANDANT_SETZEN_SQL, [mandantId]);
    const { rows } = await client.query(`SELECT 1 FROM number LIMIT 1`);
    return rows.length > 0;
  } finally {
    await client.query("ROLLBACK");
  }
}

export function nummernVorhanden(runner) {
  return runner.withClient(async (client) => {
    const { rows } = await client.query(`SELECT id FROM tenant`);
    for (const { id } of rows) {
      if (await mandantHatNummer(client, id)) return true;
    }
    return false;
  });
}
