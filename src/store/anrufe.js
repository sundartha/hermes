import * as ops from "./state-ops.js";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const ZAEHLEN_SQL = `SELECT count(*)::int AS anzahl FROM call
  WHERE tenant_id = $1 AND direction = 'outbound' AND started_at >= $2 COLLATE "C"
    AND ($3::text IS NULL OR requested_by = $3) AND ($4::text IS NULL OR to_e164 = $4)`;

const TRANSKRIPT_ANHAENGEN_SQL = `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`;
const TRANSKRIPT_LOESCHEN_SQL = `DELETE FROM transcript_segment WHERE tenant_id = $1 AND call_id = $2`;

const ENDE_FELDER = ["status", "endedAt", "consults"];
const ENDE_SQL = `UPDATE call SET status = $3, ended_at = $4, consults = $5 WHERE tenant_id = $1 AND id = $2 AND status = 'active'`;
const ENDE_WERTE = (call) => [call.status, call.endedAt, call.consults ? JSON.stringify(call.consults) : null];

const LEBENSLAUF = {
  answered: {
    felder: ["answeredAt"],
    sql: `UPDATE call SET answered_at = $3 WHERE tenant_id = $1 AND id = $2 AND answered_at IS NULL`,
    werte: (call) => [call.answeredAt],
    aendern: ops.markAnswered,
  },
  answeredNachziehen: {
    felder: ["answeredAt"],
    sql: `UPDATE call SET answered_at = $3 WHERE tenant_id = $1 AND id = $2`,
    werte: (call) => [call.answeredAt],
    aendern: ops.trueUpAnsweredAt,
  },
  unklarerGrund: {
    felder: ["answeredUnclearReason"],
    sql: `UPDATE call SET answered_unclear_reason = $3 WHERE tenant_id = $1 AND id = $2 AND answered_unclear_reason IS NULL`,
    werte: (call) => [call.answeredUnclearReason],
    aendern: ops.recordAnsweredUnclearReason,
  },
  endeStandard: {
    felder: ENDE_FELDER,
    sql: ENDE_SQL,
    werte: ENDE_WERTE,
    aendern: ops.endCallRecord,
  },
  ende: {
    felder: ENDE_FELDER,
    sql: ENDE_SQL,
    werte: ENDE_WERTE,
    aendern: ops.setCallEndedAt,
  },
};

export const unbestaetigteZeilen = new WeakSet();

export function macheAnrufeSql({ runner, einreihen }) {
  const lebenslauf = (art) => async (state, callId, ...args) => {
    const { felder, sql, werte, aendern } = LEBENSLAUF[art];
    const vorher = ops.getCall(state, callId);
    const alt = vorher && Object.fromEntries(felder.map((feld) => [feld, structuredClone(vorher[feld])]));
    const { call, changed } = aendern(state, callId, ...args);
    if (!changed) return call;
    try {
      await einreihen(async (client) => {
        await client.query(KONTEXT_SQL, [call.tenantId]);
        await client.query(sql, [call.tenantId, callId, ...werte(call)]);
      });
    } catch (err) {
      Object.assign(call, alt);
      throw err;
    }
    return call;
  };

  return {
    markAnswered: lebenslauf("answered"),
    trueUpAnsweredAt: lebenslauf("answeredNachziehen"),
    recordAnsweredUnclearReason: lebenslauf("unklarerGrund"),
    endCallRecord: lebenslauf("endeStandard"),
    setCallEndedAt: lebenslauf("ende"),
    transkriptAnhaengen: async (state, callId, { role, text }) => {
      const call = ops.getCall(state, callId);
      if (!call) return undefined;
      ops.addTranscript(state, callId, role, text);
      const zeile = call.transcript.at(-1);
      unbestaetigteZeilen.add(zeile);
      return einreihen(async (client) => {
        try {
          await client.query(KONTEXT_SQL, [call.tenantId]);
          await client.query(TRANSKRIPT_ANHAENGEN_SQL, [callId, call.tenantId, zeile.role, zeile.text, zeile.at]);
        } catch (err) {
          call.transcript.splice(call.transcript.indexOf(zeile), 1);
          throw err;
        } finally {
          unbestaetigteZeilen.delete(zeile);
        }
      });
    },
    transkriptLoeschen: (state, callId) =>
      einreihen(async (client) => {
        const call = ops.getCall(state, callId);
        if (!call) return;
        await client.query(KONTEXT_SQL, [call.tenantId]);
        await client.query(TRANSKRIPT_LOESCHEN_SQL, [call.tenantId, callId]);
        ops.purgeTranscript(state, callId);
      }),
    zaehleAusgehend: async (sinceIso, { tenantId, requestedBy = null, to = null }) => {
      if (!tenantId) throw new Error("countOutboundCallsSince: tenantId ist Pflicht");
      return runner.withClient(async (client) => {
        await client.query(KONTEXT_SQL, [tenantId]);
        const { rows } = await client.query(ZAEHLEN_SQL, [tenantId, sinceIso, requestedBy, to]);
        return rows[0].anzahl;
      });
    },
  };
}
