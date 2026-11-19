import * as ops from "./state-ops.js";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const OFFEN_BEDINGUNG = `tenant_id = $1 AND inbox_entry_at IS NOT NULL AND ($2 OR inbox_seen_at IS NULL)`;
const LESEN_SQL = `WITH wahl AS (SELECT * FROM call WHERE ${OFFEN_BEDINGUNG} ORDER BY started_at COLLATE "C", seq LIMIT $3)
  SELECT wahl.*,
    (SELECT count(*)::int FROM call WHERE ${OFFEN_BEDINGUNG}) AS spiegel_anzahl,
    (SELECT coalesce(json_agg(json_build_object('id', fremd.id, 'inbox_entry_at', fremd.inbox_entry_at)), '[]'::json)
       FROM call fremd WHERE fremd.tenant_id = $1 AND fremd.id = ANY($4)) AS spiegel_fremde
  FROM (SELECT 1) AS anker LEFT JOIN wahl ON true`;
const MARKIEREN_SQL = `UPDATE call SET inbox_seen_at = $1 WHERE tenant_id = $2 AND id = ANY($3) AND inbox_seen_at IS NULL RETURNING id`;
const FEHLER = "[pg] posteingang lesen fehlgeschlagen:";

const nachStart = (links, rechts) => (links.startedAt < rechts.startedAt ? -1 : links.startedAt > rechts.startedAt ? 1 : 0);

export function macheAnrufePosteingangSql({ runner, zeilenZuAnrufen }) {
  const lesen = (tenantId, { includeSeen, limit }, spiegelKandidaten) =>
    runner.withClient(async (client) => {
      await client.query(KONTEXT_SQL, [tenantId]);
      const { rows: alle } = await client.query(LESEN_SQL, [tenantId, includeSeen, limit, spiegelKandidaten.map((call) => call.id)]);
      const { spiegel_anzahl: anzahl, spiegel_fremde: fremde } = alle[0];
      const rows = alle.filter((zeile) => zeile.id);
      return { rows, anzahl, fremde };
    });
  const markieren = (tenantId, ids, atIso) =>
    runner.withClient(async (client) => {
      await client.query(KONTEXT_SQL, [tenantId]);
      return (await client.query(MARKIEREN_SQL, [atIso, tenantId, ids])).rows.map((zeile) => zeile.id);
    });
  return {
    async abrufen(state, tenantId, { limit, includeSeen, offeneTexte, uhr }) {
      const spiegel = ops
        .tenantCallScope(state, tenantId)
        .calls.filter((call) => call.inboxEntryAt && (includeSeen || !call.inboxSeenAt));
      let gelesen;
      try {
        gelesen = await lesen(tenantId, { includeSeen, limit }, spiegel);
      } catch (err) {
        console.error(FEHLER, err.message);
        throw err;
      }
      const inDatenbank = new Map(gelesen.fremde.map((zeile) => [zeile.id, zeile.inbox_entry_at]));
      const nurHier = spiegel.filter((call) => !inDatenbank.get(call.id));
      const ausZeilen = zeilenZuAnrufen(gelesen.rows, [], []);
      const aus = includeSeen ? ausZeilen : ausZeilen.filter((call) => !ops.getCall(state, call.id)?.inboxSeenAt);
      const gewaehlt = [...aus, ...nurHier].sort(nachStart).slice(0, limit);
      const jetzt = uhr().toISOString();
      let markiert = new Set();
      if (!includeSeen) {
        const ids = gewaehlt.filter((call) => !nurHier.includes(call)).map((call) => call.id);
        markiert = new Set(await markieren(tenantId, ids, jetzt).catch((err) => {
          console.error(FEHLER, err.message);
          throw err;
        }));
        for (const call of nurHier.filter((eigener) => gewaehlt.includes(eigener) && !eigener.inboxSeenAt)) {
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
