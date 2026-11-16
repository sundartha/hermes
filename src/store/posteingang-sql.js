import * as ops from "./state-ops.js";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const SPERRE_SQL = `SELECT pg_advisory_xact_lock(hashtext($1))`;
const ANRUF_SQL = `SELECT 1 FROM call WHERE id = $1 AND tenant_id = $2`;
const LESEN_SQL = `SELECT id, call_id AS "callId", text, type, done, created_at AS "createdAt" FROM action_item
  WHERE tenant_id = $1 AND call_id = $2 ORDER BY seq`;
const ANLEGEN_SQL = `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
  SELECT $1, tenant_id, id, $2, $3, false, $4 FROM call WHERE id = $5 AND tenant_id = $6 RETURNING id`;

async function imVorgang(client, arbeit) {
  await client.query("BEGIN");
  try {
    const ergebnis = await arbeit();
    await client.query("COMMIT");
    return ergebnis;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

function ausSpiegelEntfernen(state, call, item) {
  state.actionItems.splice(state.actionItems.indexOf(item), 1);
  call.actionItemIds.splice(call.actionItemIds.indexOf(item.id), 1);
}

async function einfuegen(client, call, item) {
  await client.query(KONTEXT_SQL, [call.tenantId]);
  await client.query(SPERRE_SQL, [call.id]);
  const { rows: vorhanden } = await client.query(LESEN_SQL, [call.tenantId, call.id]);
  const schluessel = ops.actionItemKey(item.text);
  const gleich = vorhanden.find((zeile) => ops.actionItemKey(zeile.text) === schluessel);
  if (gleich) return { zeile: gleich };
  const { rows } = await client.query(ANLEGEN_SQL, [item.id, item.text, item.type, item.createdAt, call.id, call.tenantId]);
  return { zeile: null, angelegt: rows.length > 0 };
}

export function macheAktionspunkteSql({ runner, einreihen, save }) {
  return {
    anlegen: async (state, callId, { text, type }) => {
      const call = ops.getCall(state, callId);
      if (!call) return null;
      const spiegel = ops.addActionItem(state, callId, text, type);
      if (spiegel.duplicate) return spiegel;
      try {
        const { zeile, angelegt } = await einreihen((client) => imVorgang(client, () => einfuegen(client, call, spiegel.item)));
        if (zeile) {
          Object.assign(spiegel.item, zeile);
          return { item: spiegel.item, duplicate: true };
        }
        if (!angelegt) save();
        return spiegel;
      } catch (err) {
        ausSpiegelEntfernen(state, call, spiegel.item);
        throw err;
      }
    },
    lesen: async (state, callId) => {
      const call = ops.getCall(state, callId);
      if (!call) return null;
      return runner.withClient(async (client) => {
        await client.query(KONTEXT_SQL, [call.tenantId]);
        const { rows: anruf } = await client.query(ANRUF_SQL, [callId, call.tenantId]);
        if (!anruf.length) return null;
        return (await client.query(LESEN_SQL, [call.tenantId, callId])).rows;
      });
    },
  };
}
