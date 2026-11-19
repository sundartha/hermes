import { EINSTELLUNGEN_NACHLADEN_FRIST_MS } from "../begriffe/speicher.js";

const SCHREIBEN_SQL = `INSERT INTO profile (tenant_id, data) VALUES ($1, $2)
  ON CONFLICT (tenant_id) DO UPDATE SET data = profile.data || EXCLUDED.data`;
const LOESCHEN_SQL = `DELETE FROM profile WHERE tenant_id = $1`;
const LESEN_SQL = `SELECT data FROM profile WHERE tenant_id = $1`;
const SCHREIBFEHLER = "[pg] profil schreiben fehlgeschlagen:";
const NACHLADEN_FEHLER = "[pg] profil nachladen fehlgeschlagen:";

export function macheProfilSql({
  einreihen,
  runner,
  requireState,
  protokoll = console,
  fristMs = EINSTELLUNGEN_NACHLADEN_FRIST_MS,
}) {
  const offen = new Map();
  const aenderungen = new Map();
  const kette = new Map();

  const gesichert = (tenantId, arbeit) => {
    offen.set(tenantId, (offen.get(tenantId) ?? 0) + 1);
    aenderungen.set(tenantId, (aenderungen.get(tenantId) ?? 0) + 1);
    return einreihen(arbeit)
      .catch((err) => {
        protokoll.error(SCHREIBFEHLER, err.message);
      })
      .finally(() => {
        const uebrig = offen.get(tenantId) - 1;
        if (uebrig > 0) offen.set(tenantId, uebrig);
        else offen.delete(tenantId);
      });
  };

  async function lesen(tenantId) {
    const vorher = aenderungen.get(tenantId);
    try {
      const { rows } = await runner.withClient((client) => client.query(LESEN_SQL, [tenantId]));
      if (aenderungen.get(tenantId) !== vorher) return;
      const profile = requireState().profiles;
      if (rows[0]) profile[tenantId] = rows[0].data;
      else Reflect.deleteProperty(profile, tenantId);
    } catch (err) {
      protokoll.error(NACHLADEN_FEHLER, err.message);
    }
  }

  function einzeln(tenantId) {
    const dran = (kette.get(tenantId) ?? Promise.resolve()).then(() => lesen(tenantId));
    kette.set(tenantId, dran);
    return dran;
  }

  async function nachladen(tenantId) {
    if (offen.has(tenantId)) return;
    let uhr;
    const abgelaufen = new Promise((fertig) => {
      uhr = setTimeout(() => {
        protokoll.error(NACHLADEN_FEHLER, "Frist abgelaufen");
        fertig();
      }, fristMs);
    });
    await Promise.race([einzeln(tenantId), abgelaufen]);
    clearTimeout(uhr);
  }

  return {
    nachladen,
    schreiben: (tenantId, werte) =>
      gesichert(tenantId, (client) => client.query(SCHREIBEN_SQL, [tenantId, JSON.stringify(werte)])),
    loeschen: (tenantId) => gesichert(tenantId, (client) => client.query(LOESCHEN_SQL, [tenantId])),
  };
}
