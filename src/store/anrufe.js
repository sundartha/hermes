import * as ops from "./state-ops.js";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const ZAEHLEN_SQL = `SELECT count(*)::int AS anzahl FROM call
  WHERE tenant_id = $1 AND direction = 'outbound' AND started_at >= $2 COLLATE "C"
    AND ($3::text IS NULL OR requested_by = $3) AND ($4::text IS NULL OR to_e164 = $4)`;

const TRANSKRIPT_ANHAENGEN_SQL = `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`;
const TRANSKRIPT_LOESCHEN_SQL = `DELETE FROM transcript_segment WHERE tenant_id = $1 AND call_id = $2`;

export function macheAnrufeSql({ runner, einreihen }) {
  return {
    transkriptAnhaengen: async (state, callId, { role, text }) => {
      const call = ops.getCall(state, callId);
      if (!call) return undefined;
      ops.addTranscript(state, callId, role, text);
      const zeile = call.transcript.at(-1);
      return einreihen(async (client) => {
        try {
          await client.query(KONTEXT_SQL, [call.tenantId]);
          await client.query(TRANSKRIPT_ANHAENGEN_SQL, [callId, call.tenantId, zeile.role, zeile.text, zeile.at]);
        } catch (err) {
          call.transcript.splice(call.transcript.indexOf(zeile), 1);
          throw err;
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
