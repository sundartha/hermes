const FEHLER = "[pg] kostenvergleich fehlgeschlagen:";
const LESEN_SQL = `SELECT last_checked_month_key FROM cost_cross_check WHERE id = 1`;
const MARKIEREN_SQL = `INSERT INTO cost_cross_check (id, last_checked_month_key) VALUES (1, $1)
  ON CONFLICT (id) DO UPDATE SET last_checked_month_key = GREATEST(cost_cross_check.last_checked_month_key, EXCLUDED.last_checked_month_key)`;

export function macheKostenvergleichSql({ einreihen, protokoll = console }) {
  async function ausfuehren(sql, parameter) {
    try {
      return await einreihen((client) => client.query(sql, parameter));
    } catch (fehler) {
      protokoll.error(FEHLER, fehler.message);
      throw fehler;
    }
  }

  return {
    async lesen() {
      const { rows } = await ausfuehren(LESEN_SQL, []);
      return rows[0]?.last_checked_month_key ?? null;
    },
    async markieren(monatsschluessel) {
      if (!monatsschluessel) return;
      await ausfuehren(MARKIEREN_SQL, [monatsschluessel]);
    },
  };
}
