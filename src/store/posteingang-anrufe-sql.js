import * as ops from "./state-ops.js";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const WAHL_SQL = `SELECT * FROM call WHERE tenant_id = $1 AND inbox_entry_at IS NOT NULL AND ($2 OR inbox_seen_at IS NULL)
  ORDER BY started_at COLLATE "C", seq LIMIT $3`;
const ZAEHLEN_SQL = `SELECT count(*)::int AS anzahl FROM call WHERE tenant_id = $1 AND inbox_entry_at IS NOT NULL AND ($2 OR inbox_seen_at IS NULL)`;
const ZEILEN_SQL = `SELECT id, inbox_entry_at FROM call WHERE tenant_id = $1 AND id = ANY($2)`;
const MARKIEREN_SQL = `UPDATE call SET inbox_seen_at = $1 WHERE tenant_id = $2 AND id = ANY($3) AND inbox_seen_at IS NULL RETURNING id`;
const FEHLER = "[pg] posteingang lesen fehlgeschlagen:";

const nachStart = (links, rechts) => (links.startedAt < rechts.startedAt ? -1 : links.startedAt > rechts.startedAt ? 1 : 0);

export function macheAnrufePosteingangSql({ runner, zeilenZuAnrufen }) {
  const lesen = (tenantId, includeSeen, limit, spiegelKandidaten) =>
    runner.withClient(async (client) => {
      await client.query(KONTEXT_SQL, [tenantId]);
      const { rows } = await client.query(WAHL_SQL, [tenantId, includeSeen, limit]);
      const { rows: [{ anzahl }] } = await client.query(ZAEHLEN_SQL, [tenantId, includeSeen]);
      const fremde = spiegelKandidaten.length
        ? (await client.query(ZEILEN_SQL, [tenantId, spiegelKandidaten.map((call) => call.id)])).rows
        : [];
      return { rows, anzahl, fremde };
    });
  const markieren = (tenantId, ids, atIso) =>
    runner.withClient(async (client) => {
      await client.query(KONTEXT_SQL, [tenantId]);
      return (await client.query(MARKIEREN_SQL, [atIso, tenantId, ids])).rows.map((zeile) => zeile.id);
    });
  return {
    async abrufen(state, tenantId, { limit, includeSeen }, offeneTexte) {
      const spiegel = ops
        .tenantCallScope(state, tenantId)
        .calls.filter((call) => call.inboxEntryAt && (includeSeen || !call.inboxSeenAt));
      let gelesen;
      try {
        gelesen = await lesen(tenantId, includeSeen, limit, spiegel);
      } catch (err) {
        console.error(FEHLER, err.message);
        throw err;
      }
      const inDatenbank = new Map(gelesen.fremde.map((zeile) => [zeile.id, zeile.inbox_entry_at]));
      const nurHier = spiegel.filter((call) => !inDatenbank.get(call.id));
      const ausZeilen = zeilenZuAnrufen(gelesen.rows, [], []);
      const aus = includeSeen ? ausZeilen : ausZeilen.filter((call) => !ops.getCall(state, call.id)?.inboxSeenAt);
      const gewaehlt = [...aus, ...nurHier].sort(nachStart).slice(0, limit);
      const jetzt = new Date().toISOString();
      let markiert = new Set();
      if (!includeSeen) {
        const ids = gewaehlt.filter((call) => !nurHier.includes(call)).map((call) => call.id);
        markiert = new Set(await markieren(tenantId, ids, jetzt).catch((err) => {
          console.error(FEHLER, err.message);
          throw err;
        }));
        for (const call of nurHier.filter((eigener) => gewaehlt.includes(eigener))) {
          call.inboxSeenAt = jetzt;
          markiert.add(call.id);
        }
      }
      for (const id of markiert) {
        const eigener = ops.getCall(state, id);
        if (eigener && !eigener.inboxSeenAt) eigener.inboxSeenAt = jetzt;
      }
      const entries = gewaehlt
        .filter((call) => includeSeen || markiert.has(call.id))
        .map((call) => ops.inboxEntryView(call, offeneTexte(call.id)));
      return { entries, remaining: gelesen.anzahl - (ausZeilen.length - aus.length) + nurHier.length - gewaehlt.length, marked: markiert.size };
    },
  };
}
