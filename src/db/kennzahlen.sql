SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

CREATE SCHEMA IF NOT EXISTS kennzahlen;

CREATE OR REPLACE VIEW kennzahlen.messwerte AS
WITH heute AS (
  SELECT
    direction,
    ended_at IS NOT NULL AS beendet,
    objective_achieved,
    COALESCE(estimated_cost_cents, 0) AS kosten,
    CASE WHEN jsonb_typeof(consults) = 'array' THEN jsonb_array_length(consults) ELSE 0 END AS rueckfragen,
    CASE
      WHEN answered_at IS NOT NULL AND ended_at IS NOT NULL
        AND pg_input_is_valid(answered_at, 'timestamptz') AND pg_input_is_valid(ended_at, 'timestamptz')
      THEN round(extract(epoch FROM ended_at::timestamptz - answered_at::timestamptz))::bigint
    END AS dauer_s,
    CASE
      WHEN answered_at IS NOT NULL AND ended_at IS NOT NULL THEN 'angenommen'
      WHEN answered_at IS NOT NULL THEN 'laufend'
      WHEN failure_reason = 'no-answer' THEN 'nicht_angenommen'
      WHEN failure_reason = 'busy' THEN 'besetzt'
      WHEN failure_reason = 'failed' OR failure_reason LIKE 'failed:%' THEN 'fehlgeschlagen'
      WHEN failure_reason IS NULL AND ended_at IS NULL THEN 'laufend'
      ELSE 'sonstige'
    END AS ergebnis
  FROM call
  WHERE left(started_at, 10) = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
),
richtungen(richtung) AS (VALUES ('inbound'), ('outbound')),
ergebnisse(ergebnis) AS (VALUES ('angenommen'), ('nicht_angenommen'), ('besetzt'), ('fehlgeschlagen'), ('laufend'), ('sonstige')),
ziele(ziel) AS (VALUES ('erreicht'), ('nicht_erreicht'), ('unbekannt')),
plaene(plan) AS (VALUES ('starter'), ('business'))
SELECT 'anrufe_heute'::text AS messwert, r.richtung, e.ergebnis, ''::text AS ziel, ''::text AS plan,
       (SELECT count(*) FROM heute h WHERE h.direction = r.richtung AND h.ergebnis = e.ergebnis)::bigint AS wert
  FROM richtungen r CROSS JOIN ergebnisse e
UNION ALL
SELECT 'zielerreichung_heute', '', '', z.ziel, '',
       (SELECT count(*) FROM heute h
         WHERE h.beendet
           AND z.ziel = CASE h.objective_achieved WHEN 'true' THEN 'erreicht' WHEN 'false' THEN 'nicht_erreicht' ELSE 'unbekannt' END)::bigint
  FROM ziele z
UNION ALL
SELECT 'gespraechsdauer_sekunden_heute', r.richtung, '', '', '',
       (SELECT COALESCE(sum(h.dauer_s), 0) FROM heute h WHERE h.direction = r.richtung)::bigint
  FROM richtungen r
UNION ALL
SELECT 'beantwortete_anrufe_heute', r.richtung, '', '', '',
       (SELECT count(h.dauer_s) FROM heute h WHERE h.direction = r.richtung)::bigint
  FROM richtungen r
UNION ALL
SELECT 'rueckfragen_heute', '', '', '', '', (SELECT COALESCE(sum(h.rueckfragen), 0) FROM heute h)::bigint
UNION ALL
SELECT 'kosten_heute_cent', r.richtung, '', '', '',
       (SELECT COALESCE(sum(h.kosten), 0) FROM heute h WHERE h.direction = r.richtung)::bigint
  FROM richtungen r
UNION ALL
SELECT 'anmeldungen_heute', '', '', '', '',
       (SELECT count(*) FROM (
          SELECT tenant_id FROM account GROUP BY tenant_id
          HAVING (min(created_at) AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
        ) neu)::bigint
UNION ALL
SELECT 'abos', '', '', '', p.plan,
       (SELECT count(*) FROM tenant t
         WHERE t.stripe_subscription_id IS NOT NULL AND t.status = 'active'
           AND COALESCE(t.stripe_billing_hold, '') = '' AND t.stripe_plan_slug = p.plan)::bigint
  FROM plaene p;

DROP POLICY IF EXISTS kennzahlen_lesen ON call;
CREATE POLICY kennzahlen_lesen ON call FOR SELECT USING (current_user = 'kennzahlen_leser');

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kennzahlen_leser;
GRANT USAGE ON SCHEMA kennzahlen TO kennzahlen_leser;
GRANT SELECT ON kennzahlen.messwerte TO kennzahlen_leser;

ALTER ROLE kennzahlen_leser CONNECTION LIMIT 2;
