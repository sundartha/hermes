import { MS_PER_HOUR } from "../utils/timer.js";
import { zeitplanImProzess } from "../utils/zeitplan-im-prozess.ts";

export const SESSION_AUFBEWAHRUNG_TAGE = 30;

const SWEEP_INTERVAL_HOURS = 6;
const SWEEP_INTERVAL_MS = SWEEP_INTERVAL_HOURS * MS_PER_HOUR;

const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM session
  WHERE COALESCE(invalidated_at, expires_at) < now() - make_interval(days => $1)
  RETURNING id`;

async function raeumeSessionsAuf(runner) {
  const { rows } = await runner.withClient((client) =>
    client.query(ABGELAUFENE_LOESCHEN_SQL, [SESSION_AUFBEWAHRUNG_TAGE]),
  );
  if (rows.length > 0)
    console.log(
      `[retention] ${rows.length} Sessions geloescht (aelter als ${SESSION_AUFBEWAHRUNG_TAGE} Tage)`,
    );
  return rows.length;
}

const meldeFehler = (err) =>
  console.error("[retention] Session-Aufraeumen fehlgeschlagen:", err.message);

export async function scheduleSessionRetention(runner, zeitplan = zeitplanImProzess) {
  const lauf = () => raeumeSessionsAuf(runner);
  void lauf().catch(meldeFehler);
  await zeitplan.plane("session-aufbewahrung", SWEEP_INTERVAL_MS, { lauf, beiFehler: meldeFehler });
}
