import { newId } from "./zustand/grundlagen.js";

const FEHLER = "[pg] ausfall schreiben fehlgeschlagen:";
const SPALTEN = `id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at, delivered_channels, closed_at`;
const OFFEN_SQL = `SELECT ${SPALTEN} FROM outage_alert WHERE code = $1 AND closed_at IS NULL`;
const ALLE_OFFENEN_SQL = `SELECT ${SPALTEN} FROM outage_alert WHERE closed_at IS NULL ORDER BY first_seen_at`;
const RESERVIERT_SQL = `SELECT 1 FROM outage_alert WHERE code = $1 AND last_attempt_at = $2::timestamptz`;
const ANLEGEN_SQL = `INSERT INTO outage_alert
    (id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at, delivered_channels)
  VALUES ($1, $2, $3, $3, $4, $5, $6)
  ON CONFLICT (code) WHERE closed_at IS NULL DO NOTHING
  RETURNING id`;
const AKTUALISIEREN_SQL = `UPDATE outage_alert SET last_seen_at = $2, last_attempt_at = $3, reported_at = $4,
    delivered_channels = $5 WHERE id = $1`;
const SCHLIESSEN_SQL = `UPDATE outage_alert SET closed_at = $2 WHERE code = $1 AND closed_at IS NULL`;

const iso = (wert) => (wert instanceof Date ? wert.toISOString() : (wert ?? null));

function alsMarker(zeile) {
  return {
    id: zeile.id,
    code: zeile.code,
    firstSeenAt: iso(zeile.first_seen_at),
    lastSeenAt: iso(zeile.last_seen_at),
    lastAttemptAt: iso(zeile.last_attempt_at),
    reportedAt: iso(zeile.reported_at),
    deliveredChannels: zeile.delivered_channels,
    closedAt: iso(zeile.closed_at),
  };
}

const KEIN_MARKER = { lastAttemptAt: null, reportedAt: null, deliveredChannels: null };

function werte(marker, nowIso, { sent = false, channels = [] }) {
  const alt = marker ?? KEIN_MARKER;
  const zugestellt = sent && channels.length > 0;
  return [
    sent ? nowIso : alt.lastAttemptAt,
    zugestellt ? nowIso : alt.reportedAt,
    zugestellt ? channels.join(",") : alt.deliveredChannels,
  ];
}

async function beanspruchen(client, { code, nowMs, entscheide }) {
  const nowIso = new Date(nowMs).toISOString();
  for (;;) {
    const { rows } = await client.query(`${OFFEN_SQL} FOR UPDATE`, [code]);
    const marker = rows[0] ? alsMarker(rows[0]) : undefined;
    const { ergebnis, claim } = entscheide(marker);
    if (!claim) return ergebnis;
    const gesetzt = werte(marker, nowIso, claim);
    if (marker) {
      await client.query(AKTUALISIEREN_SQL, [marker.id, nowIso, ...gesetzt]);
      return ergebnis;
    }
    const angelegt = await client.query(ANLEGEN_SQL, [newId("otg"), code, nowIso, ...gesetzt]);
    if (angelegt.rows.length > 0) return ergebnis;
  }
}

export function macheAusfallSql({ einreihen, runner }) {
  const inTransaktion = (arbeit) =>
    einreihen(async (client) => {
      await client.query("BEGIN");
      try {
        const ergebnis = await arbeit(client);
        await client.query("COMMIT");
        return ergebnis;
      } catch (fehler) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(FEHLER, fehler.message);
        throw fehler;
      }
    });
  const claim = (code, nowMs, entscheide) =>
    inTransaktion((client) => beanspruchen(client, { code, nowMs, entscheide }));
  const bei = (pruefe, sent) => (marker) => {
    const ergebnis = pruefe(marker);
    return { ergebnis, claim: ergebnis ? { sent } : null };
  };
  const lesen = (sql, parameter) => runner.withClient((client) => client.query(sql, parameter));

  return {
    sendeplatzReserviert: async ({ bucket, nowMs }) =>
      (await lesen(RESERVIERT_SQL, [bucket, new Date(nowMs).toISOString()])).rows.length > 0,
    sendeplatzReservieren: ({ bucket, nowMs, frei }) => claim(bucket, nowMs, bei(frei, true)),
    urteilClaimen: ({ bucket, nowMs, beurteile, istAlarm }, calls) =>
      claim(bucket, nowMs, (marker) => {
        const ergebnis = beurteile({ calls, marker });
        return { ergebnis, claim: istAlarm(ergebnis) ? { sent: true } : null };
      }),
    alarmVersendet: ({ code, nowMs, channels }) => claim(code, nowMs, () => ({ claim: { sent: true, channels } })),
    notizClaimen: ({ code, nowMs }) => claim(code, nowMs, () => ({ claim: { sent: false } })),
    markerSchliessen: async ({ code, nowMs }) => {
      await inTransaktion((client) => client.query(SCHLIESSEN_SQL, [code, new Date(nowMs).toISOString()]));
    },
    holdEskalationClaimen: ({ bucket, nowMs, frei = (marker) => !marker }) =>
      claim(bucket, nowMs, bei(frei, true)),
    selbsttestClaimen: ({ bucket, nowMs, faellig }) => claim(bucket, nowMs, bei(faellig, true)),
    beanspruchMarker: ({ code, nowMs, istFaellig }) => claim(code, nowMs, bei(istFaellig, false)),
    offeneMarkerSchliessen: ({ istZuSchliessen, nowMs }) =>
      inTransaktion(async (client) => {
        const { rows } = await client.query(ALLE_OFFENEN_SQL);
        const codes = rows.map((zeile) => zeile.code).filter(istZuSchliessen);
        for (const code of codes) await client.query(SCHLIESSEN_SQL, [code, new Date(nowMs).toISOString()]);
        return codes.length;
      }),
    offenerMarker: async ({ code }) => {
      const { rows } = await lesen(OFFEN_SQL, [code]);
      return rows[0] ? alsMarker(rows[0]) : undefined;
    },
    offeneAusfallZustand: async (calls) => ({
      calls,
      outageAlerts: (await lesen(ALLE_OFFENEN_SQL)).rows.map(alsMarker),
    }),
  };
}
