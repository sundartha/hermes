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
  const offen = new Map();

  function uebernehmen(tenantId, row) {
    const kopie = settingsFor(requireState(), tenantId);
    if (!row) {
      Object.assign(kopie, defaultSettings());
      stand.delete(tenantId);
      return;
    }
    Object.assign(kopie, rowToSettings(row));
    stand.set(tenantId, Number(row.stand));
  }

  async function kopieAbgleichen(client, tenantId, row) {
    try {
      if (row === null) uebernehmen(tenantId, await einstellungenLesen(client, tenantId));
      else if (Number(row.stand) > (stand.get(tenantId) ?? KEIN_STAND)) uebernehmen(tenantId, row);
    } catch (err) {
      protokoll.error("[pg] einstellungen nachladen fehlgeschlagen:", err.message);
    }
  }

  async function lauf(client, tenantId, aenderung) {
    let row = null;
    let geschrieben = true;
    try {
      row = await einstellungenSchreiben(client, tenantId, aenderung);
    } catch (err) {
      geschrieben = false;
      protokoll.error("[pg] einstellungen schreiben fehlgeschlagen:", err.message);
    }
    const uebrig = offen.get(tenantId) - 1;
    if (uebrig > 0) offen.set(tenantId, uebrig);
    else offen.delete(tenantId);
    if (uebrig === 0) await kopieAbgleichen(client, tenantId, row);
    return geschrieben;
  }

  function schreiben(tenantId, schluessel) {
    const settings = { ...settingsFor(requireState(), tenantId) };
    offen.set(tenantId, (offen.get(tenantId) ?? 0) + 1);
    return einreihen((client) => lauf(client, tenantId, { settings, schluessel }));
  }

  return { schreiben };
}
