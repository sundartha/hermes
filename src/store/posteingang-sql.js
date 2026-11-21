import * as ops from "./state-ops.js";
import { MAX_NOTIFICATIONS } from "../begriffe/speicher.js";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const SPERRE_SQL = `SELECT pg_advisory_xact_lock(hashtext($1))`;
const ANRUF_SQL = `SELECT 1 FROM call WHERE id = $1 AND tenant_id = $2`;
const LESEN_SQL = `SELECT id, call_id AS "callId", text, type, done, created_at AS "createdAt" FROM action_item
  WHERE tenant_id = $1 AND call_id = $2 ORDER BY seq`;
const MANDANT_PUNKTE_SQL = `SELECT id, call_id AS "callId", text, type, done, created_at AS "createdAt" FROM action_item
  WHERE tenant_id = $1 ORDER BY seq DESC`;
const MANDANT_MELDUNGEN_SQL = `SELECT id, title, body, call_id AS "callId", at FROM notification
  WHERE tenant_id = $1 ORDER BY seq DESC`;
const ANLEGEN_SQL = `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
  SELECT $1, tenant_id, id, $2, $3, false, $4 FROM call WHERE id = $5 AND tenant_id = $6 FOR SHARE RETURNING id`;
const MELDUNG_ANLEGEN_SQL = `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
  SELECT $1, tenant_id, $2, $3, id, $4 FROM call WHERE id = $5 AND tenant_id = $6 FOR SHARE ON CONFLICT (id) DO NOTHING RETURNING id`;
const PUNKT_NACHSCHREIBEN_SQL = `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
  SELECT $1, tenant_id, id, $2, $3, $4, $5 FROM call WHERE id = $6 FOR SHARE ON CONFLICT (id) DO NOTHING`;
const MELDUNG_NACHSCHREIBEN_SQL = `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
  SELECT $1, tenant_id, $2, $3, id, $4 FROM call WHERE id = $5 FOR SHARE ON CONFLICT (id) DO NOTHING`;
const MELDUNG_OHNE_ANRUF_NACHSCHREIBEN_SQL = `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
  SELECT $1, id, $2, $3, NULL, $4 FROM tenant WHERE id = $5 ON CONFLICT (id) DO NOTHING`;
const ERLEDIGT_SQL = `UPDATE action_item SET done = $1 WHERE id = $2 AND tenant_id = $3`;
const MELDUNG_KUERZEN_SQL = `DELETE FROM notification WHERE tenant_id = $1 AND id NOT IN
  (SELECT id FROM notification WHERE tenant_id = $1 ORDER BY seq DESC LIMIT $2)`;

const inDatenbank = new WeakSet();

export function inDatenbankMerken(eintraege) {
  for (const eintrag of eintraege) inDatenbank.add(eintrag);
}

export async function ausstehendeSchreiben(client, tenantId, { punkte, meldungen }) {
  const offeneMeldungen = meldungen.filter((meldung) => !inDatenbank.has(meldung));
  const offenePunkte = punkte.filter((punkt) => !inDatenbank.has(punkt));
  for (const it of offenePunkte.toReversed()) {
    await client.query(PUNKT_NACHSCHREIBEN_SQL, [it.id, it.text, it.type, it.done, it.createdAt, it.callId]);
  }
  for (const meldung of offeneMeldungen.toReversed()) {
    const [sql, ziel] = meldung.callId ? [MELDUNG_NACHSCHREIBEN_SQL, meldung.callId] : [MELDUNG_OHNE_ANRUF_NACHSCHREIBEN_SQL, tenantId];
    await client.query(sql, [meldung.id, meldung.title, meldung.body, meldung.at, ziel]);
  }
  await client.query(MELDUNG_KUERZEN_SQL, [tenantId, MAX_NOTIFICATIONS]);
  return [...offenePunkte, ...offeneMeldungen];
}

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

function ausSpiegelEntfernen(state, item) {
  const stelle = state.actionItems.indexOf(item);
  if (stelle < 0) return;
  state.actionItems.splice(stelle, 1);
  const ids = ops.getCall(state, item.callId)?.actionItemIds;
  const idStelle = ids?.indexOf(item.id) ?? -1;
  if (idStelle >= 0) ids.splice(idStelle, 1);
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

async function meldungEinfuegen(client, call, meldung) {
  await client.query(KONTEXT_SQL, [call.tenantId]);
  const { rows } = await client.query(MELDUNG_ANLEGEN_SQL, [meldung.id, meldung.title, meldung.body, meldung.at, call.id, call.tenantId]);
  await client.query(MELDUNG_KUERZEN_SQL, [call.tenantId, MAX_NOTIFICATIONS]);
  return rows.length > 0;
}

export function macheAktionspunkteSql({ runner, einreihen, save, leseCallUngebunden }) {
  const anrufFuer = async (state, callId) => ops.getCall(state, callId) ?? (await leseCallUngebunden(callId));
  return {
    benachrichtigen: async (state, { title, body, callId }) => {
      const call = await anrufFuer(state, callId);
      if (!call) return null;
      ops.addNotification(state, title, body, callId);
      const meldung = state.notifications[0];
      return einreihen((client) => imVorgang(client, () => meldungEinfuegen(client, call, meldung))).then(
        (angelegt) => {
          if (angelegt) inDatenbank.add(meldung);
          return true;
        },
        (err) => {
          state.notifications.splice(state.notifications.indexOf(meldung), 1);
          throw err;
        },
      );
    },
    umschalten: (state, item) => {
      const schreiben = (call) =>
        einreihen(async (client) => {
          await client.query(KONTEXT_SQL, [call.tenantId]);
          await client.query(ERLEDIGT_SQL, [item.done, item.id, call.tenantId]);
        });
      const gespiegelt = ops.getCall(state, item.callId);
      if (gespiegelt) return schreiben(gespiegelt);
      return leseCallUngebunden(item.callId).then((call) => (call ? schreiben(call) : null));
    },
    anlegen: async (state, callId, { text, type }) => {
      const vorhanden = ops.callActionItems(state, callId).find((punkt) => ops.actionItemKey(punkt.text) === ops.actionItemKey(text));
      if (vorhanden) return { item: vorhanden, duplicate: true };
      const call = await anrufFuer(state, callId);
      if (!call) return null;
      const spiegel = ops.addActionItem(state, callId, text, type);
      if (spiegel.duplicate) return spiegel;
      try {
        const { zeile, angelegt } = await einreihen((client) => imVorgang(client, () => einfuegen(client, call, spiegel.item)));
        if (zeile) {
          Object.assign(spiegel.item, zeile);
          inDatenbank.add(spiegel.item);
          return { item: spiegel.item, duplicate: true };
        }
        if (angelegt) inDatenbank.add(spiegel.item);
        else save();
        return spiegel;
      } catch (err) {
        ausSpiegelEntfernen(state, spiegel.item);
        throw err;
      }
    },
    mandantLesen: (tenantId) =>
      runner.withClient(async (client) => {
        await client.query(KONTEXT_SQL, [tenantId]);
        const { rows: actionItems } = await client.query(MANDANT_PUNKTE_SQL, [tenantId]);
        const { rows: notifications } = await client.query(MANDANT_MELDUNGEN_SQL, [tenantId]);
        return { actionItems, notifications };
      }),
    lesen: async (state, callId) => {
      const call = await anrufFuer(state, callId);
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
