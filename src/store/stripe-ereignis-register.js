import { randomUUID } from "node:crypto";
import { sleep } from "../utils/timer.js";
import { STRIPE_EREIGNIS_ABFRAGE_FRIST_MS, STRIPE_EREIGNIS_SPERRE_ABLAUF_MS } from "../begriffe/speicher.js";
import { wartenBisFrei } from "./stripe-ereignis-regeln.js";

const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true)`;
const NEHMEN_SQL = `
  INSERT INTO stripe_ereignis_register AS r (schluessel, sperre_inhaber, sperre_bis)
  VALUES ($1, $2, now() + ($3::int * interval '1 millisecond'))
  ON CONFLICT (schluessel) DO UPDATE SET
    sperre_inhaber = EXCLUDED.sperre_inhaber,
    sperre_bis = EXCLUDED.sperre_bis
  WHERE r.sperre_bis IS NULL OR r.sperre_bis < now()
  RETURNING ereignis_id, erstellt_s, aktion`;
const GEBEN_SQL = `
  UPDATE stripe_ereignis_register SET sperre_inhaber = NULL, sperre_bis = NULL
  WHERE schluessel = $1 AND sperre_inhaber = $2`;
const EINTRAGEN_SQL = `
  UPDATE stripe_ereignis_register SET
    ereignis_id = $3,
    erstellt_s = $4,
    aktion = $5,
    angewendet_um = now()
  WHERE schluessel = $1 AND sperre_inhaber = $2
    AND (erstellt_s IS NULL OR $4::bigint IS NULL OR erstellt_s <= $4::bigint)`;

function ankerAusZeile(zeile) {
  return { eventId: zeile.ereignis_id, createdAt: Number.parseFloat(zeile.erstellt_s), action: zeile.aktion };
}

export function makeStripeEreignisRegister(runner) {
  const abfrage = (sql, werte) =>
    runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(FRIST_SQL, [String(STRIPE_EREIGNIS_ABFRAGE_FRIST_MS)]);
        const ergebnis = await client.query(sql, werte);
        await client.query("COMMIT");
        return ergebnis;
      } catch (fehler) {
        await client.query("ROLLBACK").catch(() => {});
        throw fehler;
      }
    });

  async function nehmen(schluessel, inhaber) {
    const versuch = async () =>
      (await abfrage(NEHMEN_SQL, [schluessel, inhaber, STRIPE_EREIGNIS_SPERRE_ABLAUF_MS])).rows[0];
    return wartenBisFrei({ versuch, jetzt: Date.now, schlafen: sleep });
  }

  return {
    async mitSchluessel(schluessel, arbeit) {
      const inhaber = randomUUID();
      const zeile = await nehmen(schluessel, inhaber);
      const eintragen = (anker) =>
        abfrage(EINTRAGEN_SQL, [
          schluessel,
          inhaber,
          anker.eventId,
          Number.isFinite(anker.createdAt) ? anker.createdAt : null,
          anker.action,
        ]);
      try {
        return await arbeit({ letzter: ankerAusZeile(zeile), eintragen });
      } finally {
        await abfrage(GEBEN_SQL, [schluessel, inhaber]);
      }
    },
  };
}
