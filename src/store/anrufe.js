import * as ops from "./state-ops.js";
import { MS_PER_DAY } from "../utils/timer.ts";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const ZAEHLEN_SQL = `SELECT count(*)::int AS anzahl FROM call
  WHERE tenant_id = $1 AND direction = 'outbound' AND started_at >= $2 COLLATE "C"
    AND ($3::text IS NULL OR requested_by = $3) AND ($4::text IS NULL OR to_e164 = $4)`;

const GEDAECHTNIS_SQL = `SELECT id, started_at AS "startedAt", result FROM call
  WHERE tenant_id = $1 AND direction = 'outbound' AND to_e164 = $2`;
const GEDAECHTNIS_FEHLER = "[pg] gedaechtnis lesen fehlgeschlagen:";

const TRANSKRIPT_ANHAENGEN_SQL = `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`;
const TRANSKRIPT_LOESCHEN_SQL = `DELETE FROM transcript_segment WHERE tenant_id = $1 AND call_id = $2`;

const MANDANT_LOESCHEN_SQL = `WITH segmente AS (SELECT count(*)::int AS anzahl FROM transcript_segment WHERE tenant_id = $1),
  weg AS (DELETE FROM call WHERE tenant_id = $1 RETURNING id)
  SELECT (SELECT count(*)::int FROM weg) AS calls, (SELECT anzahl FROM segmente) AS "transcriptSegments"`;

const MANDANT_REST_SQL = [
  `DELETE FROM action_item WHERE tenant_id = $1`,
  `DELETE FROM notification WHERE tenant_id = $1`,
];

const MANDANTEN_SQL = `SELECT id FROM tenant`;
const ANZAHL = (cte) => `WITH weg AS (${cte}) SELECT count(*)::int AS anzahl FROM weg`;
const ABGELAUFEN = `ended_at IS NOT NULL AND ended_at < $2 COLLATE "C"`;
const AUFBEWAHREN_ANRUFE_SQL = ANZAHL(
  `DELETE FROM call WHERE tenant_id = $1 AND status <> 'active' AND ${ABGELAUFEN} RETURNING id`,
);
const AUFBEWAHREN_DIAGNOSE_SQL = `WITH weg AS (DELETE FROM transcript_segment WHERE tenant_id = $1 AND call_id IN
  (SELECT id FROM call WHERE tenant_id = $1 AND diagnostic = true AND ${ABGELAUFEN}) RETURNING call_id)
  SELECT count(DISTINCT call_id)::int AS anzahl FROM weg`;
const AUFBEWAHREN_BELEGE_SQL = ANZAHL(
  `UPDATE call SET result = result - 'evidence' WHERE tenant_id = $1 AND ${ABGELAUFEN} AND result ? 'evidence' RETURNING id`,
);
const AUFBEWAHREN_AKTIONSPUNKTE_SQL = `DELETE FROM action_item WHERE tenant_id = $1 AND done = true AND created_at < $2 COLLATE "C"`;
const AUFBEWAHREN_MELDUNGEN_SQL = `DELETE FROM notification WHERE tenant_id = $1 AND at < $2 COLLATE "C"`;
const GRENZE = (tage) => new Date(Date.now() - Math.max(tage, 0) * MS_PER_DAY).toISOString();

const ENDE_FELDER = ["status", "endedAt", "consults"];
const ENDE_SQL = `UPDATE call SET status = $3, ended_at = $4, consults = $5, failure_reason = COALESCE(failure_reason, $6) WHERE tenant_id = $1 AND id = $2 AND status = 'active'`;
const ENDE_WERTE = (call) => [call.status, call.endedAt, call.consults ? JSON.stringify(call.consults) : null, call.failureReason ?? null];

const ZAEHLER = {
  noSpeech: {
    feld: "noSpeechStreak",
    sql: `UPDATE call SET no_speech_streak = no_speech_streak + 1 WHERE tenant_id = $1 AND id = $2 RETURNING no_speech_streak AS wert`,
    spiegel: ops.countNoSpeechTurn,
  },
  lookups: {
    feld: "lookups",
    sql: `UPDATE call SET lookups = lookups + 1 WHERE tenant_id = $1 AND id = $2 RETURNING lookups AS wert`,
    spiegel: ops.countCallLookup,
  },
};
const STILLE_ZURUECK_SQL = `UPDATE call SET no_speech_streak = 0 WHERE tenant_id = $1 AND id = $2`;
const ABFRAGE_SQL = `UPDATE call SET consult_polled_at_ms = $3 WHERE tenant_id = $1 AND id = $2`;
const ABFRAGE_FEHLER = "[pg] Rueckfrage-Abfrage notieren fehlgeschlagen:";

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

const EINMAL_MARKE = (spalte, feld, aendern) => ({
  felder: [feld],
  sql: `UPDATE call SET ${spalte} = $3 WHERE tenant_id = $1 AND id = $2 AND ${spalte} IS NULL`,
  werte: (call) => [call[feld]],
  aendern,
});

const FELDER = {
  summarySms: EINMAL_MARKE("summary_sms_sent_at", "summarySmsSentAt", ops.markSummarySmsSent),
  summaryMail: EINMAL_MARKE("summary_mail_sent_at", "summaryMailSentAt", ops.markSummaryMailSent),
  notPlacedMail: EINMAL_MARKE("not_placed_mail_sent_at", "notPlacedMailSentAt", ops.markNotPlacedMailSent),
  abgerechnet: EINMAL_MARKE("billed_at", "billedAt", ops.markBilled),
  posteingang: EINMAL_MARKE("inbox_entry_at", "inboxEntryAt", ops.markInboxEntry),
  webhookAnker: {
    felder: ["webhookAnchors"],
    sql: `UPDATE call SET webhook_anchors = $3 WHERE tenant_id = $1 AND id = $2`,
    werte: (call) => [call.webhookAnchors.length ? JSON.stringify(call.webhookAnchors) : null],
    aendern: ops.recordWebhookAnchors,
  },
  geschaetzteKosten: {
    felder: ["estimatedCostCents", "estimatedCostSpendMonthKey", "estimatedCostPeriodKey"],
    sql: `UPDATE call SET estimated_cost_cents = $3, estimated_cost_spend_month_key = $4, estimated_cost_period_key = $5
      WHERE tenant_id = $1 AND id = $2 AND estimated_cost_cents IS NULL`,
    werte: (call) => [call.estimatedCostCents, call.estimatedCostSpendMonthKey, call.estimatedCostPeriodKey],
    aendern: ops.recordCallEstimatedCostCents,
  },
  kostenAbgleich: {
    felder: ["costTruingAttempts", "actualCostMicroCents", "costTruedSource", "costTruedAt"],
    sql: `UPDATE call SET cost_truing_attempts = $3, actual_cost_micro_cents = $4, cost_trued_source = $5, cost_trued_at = $6
      WHERE tenant_id = $1 AND id = $2 AND cost_trued_at IS NULL`,
    werte: (call) => [call.costTruingAttempts, call.actualCostMicroCents ?? null, call.costTruedSource, call.costTruedAt ?? null],
    aendern: ops.recordCallCostTruingResult,
  },
  detektorZaehlung: {
    felder: ["elDetectorCounts"],
    sql: `UPDATE call SET el_detector_counts = $3 WHERE tenant_id = $1 AND id = $2 AND el_detector_counts IS NULL`,
    werte: (call) => [JSON.stringify(call.elDetectorCounts)],
    aendern: ops.recordElDetectorCounts,
  },
};

async function aufbewahrenJeMandant(client, { retentionDays, diagnosticRetentionDays, evidenceRetentionDays }) {
  const summe = { calls: 0, diagnosticTranscripts: 0, resultEvidence: 0 };
  const grenzen = [GRENZE(retentionDays), GRENZE(diagnosticRetentionDays), GRENZE(evidenceRetentionDays)];
  const { rows: mandanten } = await client.query(MANDANTEN_SQL);
  for (const { id } of mandanten) {
    await client.query(KONTEXT_SQL, [id]);
    const zaehle = async (sql, grenze) => {
      const { rows } = await client.query(sql, [id, grenze]);
      return rows[0].anzahl;
    };
    if (retentionDays > 0) summe.calls += await zaehle(AUFBEWAHREN_ANRUFE_SQL, grenzen[0]);
    if (retentionDays > 0) await client.query(AUFBEWAHREN_AKTIONSPUNKTE_SQL, [id, grenzen[0]]);
    if (retentionDays > 0) await client.query(AUFBEWAHREN_MELDUNGEN_SQL, [id, grenzen[0]]);
    summe.diagnosticTranscripts += await zaehle(AUFBEWAHREN_DIAGNOSE_SQL, grenzen[1]);
    summe.resultEvidence += await zaehle(AUFBEWAHREN_BELEGE_SQL, grenzen[2]);
  }
  return summe;
}

export const unbestaetigteZeilen = new WeakSet();

export function macheAnrufeSql({ runner, einreihen, lese, anhaengen }) {
  const nachlesen = (callId) => einreihen((client) => anhaengen(callId, client));
  const schreibart = (tabelle, art) => async (state, callId, ...args) => {
    const { felder, sql, werte, aendern } = tabelle[art];
    if (!ops.getCall(state, callId)) await nachlesen(callId);
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
  const lebenslauf = (art) => schreibart(LEBENSLAUF, art);
  const feld = (art) => schreibart(FELDER, art);

  return {
    markSummarySmsSent: feld("summarySms"),
    markSummaryMailSent: feld("summaryMail"),
    markNotPlacedMailSent: feld("notPlacedMail"),
    markBilled: feld("abgerechnet"),
    markInboxEntry: feld("posteingang"),
    recordWebhookAnchors: feld("webhookAnker"),
    recordCallEstimatedCostCents: feld("geschaetzteKosten"),
    recordCallCostTruingResult: feld("kostenAbgleich"),
    recordElDetectorCounts: feld("detektorZaehlung"),
    ...macheZaehlerSql({ einreihen, lese }),
    markAnswered: lebenslauf("answered"),
    trueUpAnsweredAt: lebenslauf("answeredNachziehen"),
    recordAnsweredUnclearReason: lebenslauf("unklarerGrund"),
    endCallRecord: lebenslauf("endeStandard"),
    setCallEndedAt: lebenslauf("ende"),
    transkriptAnhaengen: async (state, callId, { role, text }) => {
      if (!ops.getCall(state, callId)) await nachlesen(callId);
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
        const call = ops.getCall(state, callId) ?? (await anhaengen(callId, client));
        if (!call) return;
        await client.query(KONTEXT_SQL, [call.tenantId]);
        await client.query(TRANSKRIPT_LOESCHEN_SQL, [call.tenantId, callId]);
        ops.purgeTranscript(state, callId);
      }),
    mandantLoeschen: (tenantId) =>
      einreihen(async (client) => {
        await client.query(KONTEXT_SQL, [tenantId]);
        const zaehlung = (await client.query(MANDANT_LOESCHEN_SQL, [tenantId])).rows[0];
        for (const sql of MANDANT_REST_SQL) await client.query(sql, [tenantId]);
        return zaehlung;
      }),
    aufbewahren: (fristen) => einreihen((client) => aufbewahrenJeMandant(client, fristen)),
    gedaechtnis: async (state, tenantId, e164) => {
      if (!ops.callMemoryAllowed(state, tenantId, e164)) return [];
      const eigene = ops.memoryCandidates(state, tenantId, e164);
      const bekannt = new Set(eigene.map((call) => call.id));
      const gelesen = await runner
        .withClient(async (client) => {
          await client.query(KONTEXT_SQL, [tenantId]);
          return (await client.query(GEDAECHTNIS_SQL, [tenantId, e164])).rows;
        })
        .catch((err) => {
          console.error(GEDAECHTNIS_FEHLER, err.message);
          return [];
        });
      return ops.memoryEntries([...eigene, ...gelesen.filter((zeile) => !bekannt.has(zeile.id))]);
    },
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

function macheZaehlerSql({ einreihen, lese }) {
  const zeileAendern = (tenantId, sql, werte) =>
    einreihen(async (client) => {
      await client.query(KONTEXT_SQL, [tenantId]);
      return client.query(sql, werte);
    });
  const zaehler = (art) => async (state, callId) => {
    const { feld, sql, spiegel } = ZAEHLER[art];
    const call = await lese(callId);
    if (!call) return 0;
    const { rows } = await zeileAendern(call.tenantId, sql, [call.tenantId, callId]);
    if (rows.length === 0) return spiegel(state, callId);
    const wert = Number(rows[0].wert);
    const eigene = ops.getCall(state, callId);
    if (eigene) eigene[feld] = wert;
    return wert;
  };
  return {
    countNoSpeechTurn: zaehler("noSpeech"),
    countCallLookup: zaehler("lookups"),
    clearNoSpeechStreak: async (state, callId) => {
      const call = await lese(callId);
      if (!call) return;
      await zeileAendern(call.tenantId, STILLE_ZURUECK_SQL, [call.tenantId, callId]);
      const eigene = ops.getCall(state, callId);
      if (eigene) eigene.noSpeechStreak = 0;
    },
    noteConsultPoll: async (state, callId, nowMs = Date.now()) => {
      ops.noteConsultPoll(state, callId, nowMs);
      try {
        const call = await lese(callId);
        if (call) await zeileAendern(call.tenantId, ABFRAGE_SQL, [call.tenantId, callId, nowMs]);
      } catch (err) {
        console.error(ABFRAGE_FEHLER, err.message);
      }
    },
  };
}
