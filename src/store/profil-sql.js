const SCHREIBEN_SQL = `INSERT INTO profile (tenant_id, data) VALUES ($1, $2)
  ON CONFLICT (tenant_id) DO UPDATE SET data = profile.data || EXCLUDED.data`;
const LOESCHEN_SQL = `DELETE FROM profile WHERE tenant_id = $1`;
const SCHREIBFEHLER = "[pg] profil schreiben fehlgeschlagen:";

export function macheProfilSql({ einreihen, protokoll = console }) {
  const gesichert = (arbeit) =>
    einreihen(arbeit).catch((err) => {
      protokoll.error(SCHREIBFEHLER, err.message);
    });
  return {
    schreiben: (tenantId, werte) =>
      gesichert((client) => client.query(SCHREIBEN_SQL, [tenantId, JSON.stringify(werte)])),
    loeschen: (tenantId) => gesichert((client) => client.query(LOESCHEN_SQL, [tenantId])),
  };
}
