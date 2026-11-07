import { defaultSettings } from "./defaults.js";
import { settingsFor } from "./zustand/einstellungen.js";

const SPALTE_JE_SCHLUESSEL = Object.freeze({
  agentName: "agent_name",
  greeting: "greeting",
  allowCalendar: "allow_calendar",
  allowBooking: "allow_booking",
  allowSummaries: "allow_summaries",
  allowPersonalData: "allow_personal_data",
  allowBankData: "allow_bank_data",
  smsSummaryOptIn: "sms_summary_opt_in",
  language: "language",
  agentStyle: "agent_style",
  allowResearch: "allow_research",
  allowCallMemory: "allow_call_memory",
});

const SCHLUESSEL_REIHE = Object.keys(SPALTE_JE_SCHLUESSEL);
const SPALTEN = SCHLUESSEL_REIHE.map((key) => SPALTE_JE_SCHLUESSEL[key]);
const KEIN_STAND = -1;
const ERSTER_WERT_PLATZHALTER = 2;
const SCHREIBFEHLER = "[pg] einstellungen schreiben fehlgeschlagen:";

export function rowToSettings(zeile) {
  return {
    agentName: zeile.agent_name,
    greeting: zeile.greeting,
    allowCalendar: zeile.allow_calendar,
    allowBooking: zeile.allow_booking,
    allowSummaries: zeile.allow_summaries,
    smsSummaryOptIn: zeile.sms_summary_opt_in ?? true,
    allowPersonalData: zeile.allow_personal_data,
    allowBankData: zeile.allow_bank_data,
    allowResearch: zeile.allow_research ?? false,
    allowCallMemory: zeile.allow_call_memory ?? false,
    language: zeile.language ?? null,
    agentStyle: zeile.agent_style ?? null,
  };
}

async function inEigenerTransaktion(client, tenantId, arbeit) {
  await client.query("BEGIN");
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const ergebnis = await arbeit();
    await client.query("COMMIT");
    return ergebnis;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

export function einstellungenSchreiben(client, tenantId, { settings, schluessel }) {
  const vorgaben = defaultSettings();
  const werte = SCHLUESSEL_REIHE.map((key) => settings[key] ?? vorgaben[key]);
  const platzhalter = SPALTEN.map((spalte, index) => "$" + (index + ERSTER_WERT_PLATZHALTER));
  const setzen = schluessel.map(
    (key) => `${SPALTE_JE_SCHLUESSEL[key]} = EXCLUDED.${SPALTE_JE_SCHLUESSEL[key]}`,
  );
  return inEigenerTransaktion(client, tenantId, async () => {
    const { rows } = await client.query(
      `INSERT INTO settings (tenant_id, ${SPALTEN.join(", ")})
       VALUES ($1, ${platzhalter.join(", ")})
       ON CONFLICT (tenant_id) DO UPDATE SET ${setzen.join(", ")}
       RETURNING *`,
      [tenantId, ...werte],
    );
    return rows[0];
  });
}

export function einstellungenLesen(client, tenantId) {
  return inEigenerTransaktion(client, tenantId, async () => {
    const { rows } = await client.query(`SELECT * FROM settings WHERE tenant_id = $1`, [tenantId]);
    return rows[0] ?? null;
  });
}

export function macheEinstellungenSchreiber({ einreihen, requireState, protokoll = console }) {
  const stand = new Map();
  const bestaetigt = new Map();
  const offen = new Map();

  const zuletztOffen = (tenantId) => offen.get(tenantId) === 1;

  function bestaetigen(tenantId, row) {
    if (!row) {
      bestaetigt.set(tenantId, defaultSettings());
      stand.delete(tenantId);
      return;
    }
    if (Number(row.stand) <= (stand.get(tenantId) ?? KEIN_STAND)) return;
    bestaetigt.set(tenantId, rowToSettings(row));
    stand.set(tenantId, Number(row.stand));
  }

  function kopieAbgleichen(tenantId) {
    if (zuletztOffen(tenantId)) Object.assign(settingsFor(requireState(), tenantId), bestaetigt.get(tenantId));
  }

  async function nachladen(client, tenantId) {
    try {
      bestaetigen(tenantId, await einstellungenLesen(client, tenantId));
    } catch (err) {
      protokoll.error("[pg] einstellungen nachladen fehlgeschlagen:", err.message);
    }
    kopieAbgleichen(tenantId);
  }

  async function lauf(client, tenantId, aenderung) {
    try {
      bestaetigen(tenantId, await einstellungenSchreiben(client, tenantId, aenderung));
    } catch (err) {
      protokoll.error(SCHREIBFEHLER, err.message);
      if (zuletztOffen(tenantId)) await nachladen(client, tenantId);
      return false;
    }
    kopieAbgleichen(tenantId);
    return true;
  }

  function zurueckzaehlen(tenantId) {
    const uebrig = offen.get(tenantId) - 1;
    if (uebrig > 0) offen.set(tenantId, uebrig);
    else offen.delete(tenantId);
  }

  async function schreiben(tenantId, { schluessel, vorher }) {
    if (!offen.has(tenantId)) bestaetigt.set(tenantId, vorher);
    offen.set(tenantId, (offen.get(tenantId) ?? 0) + 1);
    const settings = { ...settingsFor(requireState(), tenantId) };
    try {
      return await einreihen((client) => lauf(client, tenantId, { settings, schluessel }));
    } catch (err) {
      protokoll.error(SCHREIBFEHLER, err.message);
      kopieAbgleichen(tenantId);
      return false;
    } finally {
      zurueckzaehlen(tenantId);
    }
  }

  return { schreiben };
}
