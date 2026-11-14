import { BUDGET_RESERVIERUNG_DB_FRIST_MS } from "../begriffe/speicher.js";
import { emptyUsage } from "./leerzustaende.js";
import { RESERVIERUNG_GRUND } from "./budget-reserve.js";
import { nutzungAusZeile } from "./nutzung-pg.js";
import { gateNutzungCents } from "./zustand/budget.js";

const SPERRE_NAMENSRAUM = 2666;
const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)`;
const MANDANT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;
const SPERRE_SQL = `SELECT pg_advisory_xact_lock($1, hashtext($2))`;
const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM budget_reservierung WHERE tenant_id = $1 AND ablauf_um <= now()`;
const NUTZUNG_SQL = `SELECT * FROM usage WHERE tenant_id = $1`;
const OFFEN_SQL = `SELECT coalesce(sum(cents), 0)::float8 AS cents FROM budget_reservierung WHERE tenant_id = $1`;
const ANLEGEN_SQL = `INSERT INTO budget_reservierung (call_id, tenant_id, cents, ablauf_um)
  VALUES ($1, $2, $3, now() + make_interval(secs => $4))`;
const FREIGEBEN_SQL = `DELETE FROM budget_reservierung WHERE call_id = $1 AND tenant_id = $2`;

export function makePostgresBudgetReserve(runner) {
  const inTransaktion = (tenantId, arbeit) =>
    runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(FRIST_SQL, [String(BUDGET_RESERVIERUNG_DB_FRIST_MS)]);
        await client.query(MANDANT_SQL, [tenantId]);
        const ergebnis = await arbeit(client);
        await client.query("COMMIT");
        return ergebnis;
      } catch (fehler) {
        await client.query("ROLLBACK").catch(() => {});
        throw fehler;
      }
    });

  async function verbrauchCents(client, { tenantId, cfg }) {
    const { rows } = await client.query(NUTZUNG_SQL, [tenantId]);
    const bucket = rows.length ? nutzungAusZeile(rows[0]) : emptyUsage();
    return gateNutzungCents({ usage: { [tenantId]: bucket } }, { tenantId, cfg, nowIso: new Date().toISOString() });
  }

  async function reservieren({ callId, tenantId, cents, capCents, ablaufS, cfg }) {
    try {
      return await inTransaktion(tenantId, async (client) => {
        await client.query(SPERRE_SQL, [SPERRE_NAMENSRAUM, tenantId]);
        await client.query(ABGELAUFENE_LOESCHEN_SQL, [tenantId]);
        const verbraucht = await verbrauchCents(client, { tenantId, cfg });
        const { rows } = await client.query(OFFEN_SQL, [tenantId]);
        const verbleibend = capCents - verbraucht - rows[0].cents;
        if (cents > verbleibend)
          return { reserviert: false, grund: RESERVIERUNG_GRUND.DECKE, verbleibendCents: verbleibend };
        await client.query(ANLEGEN_SQL, [callId, tenantId, cents, ablaufS]);
        return { reserviert: true };
      });
    } catch (fehler) {
      console.error("[budget-reservierung] Datenbank nicht erreichbar, abgelehnt:", fehler.message);
      return { reserviert: false, grund: RESERVIERUNG_GRUND.DB };
    }
  }

  async function freigeben({ callId, tenantId }) {
    try {
      await inTransaktion(tenantId, (client) => client.query(FREIGEBEN_SQL, [callId, tenantId]));
    } catch (fehler) {
      console.error("[budget-reservierung] Reserve nicht freigegeben, bleibt bis zum Ablauf:", fehler.message);
    }
  }

  return { reservieren, freigeben };
}
