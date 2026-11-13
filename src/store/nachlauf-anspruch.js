import { ZUGRIFF_FRIST_MS } from "./webhook-zustellung.js";

const LOG_PREFIX = "[webhook-zustellung]";
const RESTRIKTION_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true),
  set_config('app.current_tenant', $2, true)`;
const ANSPRUCH_SQL = `UPDATE call SET el_nachlauf_started_at = $2 WHERE id = $1 AND el_nachlauf_started_at IS NULL`;
const ZEILE_SQL = `SELECT 1 FROM call WHERE id = $1`;

async function beanspruchen(client, { callId, tenantId, nowIso }) {
  await client.query("BEGIN");
  try {
    await client.query(RESTRIKTION_SQL, [String(ZUGRIFF_FRIST_MS), tenantId]);
    const { rowCount } = await client.query(ANSPRUCH_SQL, [callId, nowIso]);
    const gewonnen = rowCount === 1 || (await client.query(ZEILE_SQL, [callId])).rowCount === 0;
    await client.query("COMMIT");
    return gewonnen;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function mitFrist(arbeit) {
  let zeitgeber;
  const ablauf = new Promise((_aufgeloest, abgelehnt) => {
    zeitgeber = setTimeout(() => abgelehnt(Object.assign(new Error("Zugriffsfrist abgelaufen"), { frist: true })), ZUGRIFF_FRIST_MS);
  });
  try {
    return await Promise.race([arbeit, ablauf]);
  } finally {
    clearTimeout(zeitgeber);
  }
}

export function macheNachlaufAnspruch({ runner, store }) {
  const verarbeiten = (callId, nowIso) => store.markInboundElNachlaufStarted(callId, nowIso);
  return async function beanspruecheInboundElNachlauf(callId, nowIso) {
    const call = store.getCall(callId);
    if (call.elNachlaufStartedAt) return verarbeiten(callId, nowIso);
    const anfrage = { callId, tenantId: call.tenantId, nowIso };
    const gewonnen = await mitFrist(runner.withClient((client) => beanspruchen(client, anfrage))).catch((err) => {
      console.log(`${LOG_PREFIX} nachlauf_anspruch grund=${err.frist ? "frist" : "fehler"}`);
      return true;
    });
    return gewonnen ? verarbeiten(callId, nowIso) : { call, changed: false };
  };
}
