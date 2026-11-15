import { mitZeitgrenze } from "./webhook-zustellung.js";

const LOG_PREFIX = "[webhook-zustellung]";
const TENANT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;
const ANSPRUCH_SQL = `UPDATE call SET el_nachlauf_started_at = $2 WHERE id = $1 AND el_nachlauf_started_at IS NULL`;
const ZEILE_SQL = `SELECT 1 FROM call WHERE id = $1`;

async function beanspruchen(anweisung, { callId, tenantId, nowIso }) {
  await anweisung.query(TENANT_SQL, [tenantId]);
  const { rowCount } = await anweisung.query(ANSPRUCH_SQL, [callId, nowIso]);
  return rowCount === 1 || (await anweisung.query(ZEILE_SQL, [callId])).rowCount === 0;
}

export function macheNachlaufAnspruch({ runner, store }) {
  const verarbeiten = (callId, nowIso) => store.markInboundElNachlaufStarted(callId, nowIso);
  return async function beanspruecheInboundElNachlauf(callId, nowIso) {
    const call = store.getCall(callId);
    if (call.elNachlaufStartedAt) return verarbeiten(callId, nowIso);
    const anfrage = { callId, tenantId: call.tenantId, nowIso };
    const gewonnen = await mitZeitgrenze(runner, { arbeit: (anweisung) => beanspruchen(anweisung, anfrage) }).catch((err) => {
      console.log(`${LOG_PREFIX} nachlauf_anspruch grund=${err.frist ? "frist" : "fehler"}`);
      return true;
    });
    return gewonnen ? verarbeiten(callId, nowIso) : { call, changed: false };
  };
}
