import { imMandanten } from "./fristen-sql.js";
import { addCalendarEvent, findConflict, getCalendar } from "./state-ops.js";

const FEHLER = "[pg] kalender fehlgeschlagen:";
const LESEN_SQL = `SELECT id, title, starts_at, ends_at FROM calendar_event WHERE tenant_id = $1 ORDER BY seq ASC`;
const EINFUEGEN_SQL = `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5)`;

function zeileZuTermin(zeile) {
  return { id: zeile.id, title: zeile.title, start: zeile.starts_at, end: zeile.ends_at };
}

const ansicht = (tenantId, termine) => ({ calendar: { [tenantId]: termine } });

export function macheKalenderSql({ einreihen, protokoll = console }) {
  async function ausfuehren(tenantId, anweisung) {
    try {
      return await einreihen((client) => imMandanten(client, tenantId, anweisung));
    } catch (fehler) {
      protokoll.error(FEHLER, fehler.message);
      throw fehler;
    }
  }

  async function termine(tenantId) {
    const zeilen = await ausfuehren(tenantId, [LESEN_SQL, [tenantId]]);
    return ansicht(tenantId, zeilen.map(zeileZuTermin));
  }

  return {
    async liste(tenantId) {
      return getCalendar(await termine(tenantId), tenantId);
    },
    async hinzufuegen(eingabe) {
      const termin = addCalendarEvent(ansicht(eingabe.tenantId, []), eingabe);
      await ausfuehren(eingabe.tenantId, [
        EINFUEGEN_SQL,
        [termin.id, eingabe.tenantId, termin.title, termin.start, termin.end],
      ]);
      return termin;
    },
    async konflikt(tenantId, startIso, endIso) {
      return findConflict(await termine(tenantId), tenantId, startIso, endIso);
    },
  };
}
