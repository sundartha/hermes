import { defaultSettings } from "./leerzustaende.js";
import { settingsFor } from "./zustand/einstellungen.js";
import { EINSTELLUNGEN_NACHLADEN_FRIST_MS } from "../begriffe/speicher.js";

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
const NACHLADEN_FEHLER = "[pg] einstellungen nachladen fehlgeschlagen:";
const RECHTE_SCHLUESSEL = Object.freeze([
  "allowCallMemory",
  "allowBankData",
  "allowPersonalData",
  "allowResearch",
]);

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

function innerhalbFrist(versprechen, fristMs, beiAblauf) {
  let uhr;
  const abgelaufen = new Promise((resolve) => {
    uhr = setTimeout(() => {
      beiAblauf();
      resolve(false);
    }, fristMs);
  });
  return Promise.race([versprechen, abgelaufen]).finally(() => clearTimeout(uhr));
}

function bestaetigen({ stand, bestaetigt }, tenantId, row) {
  if (!row) {
    bestaetigt.set(tenantId, defaultSettings());
    stand.delete(tenantId);
    return true;
  }
  if (Number(row.stand) <= (stand.get(tenantId) ?? KEIN_STAND)) return false;
  bestaetigt.set(tenantId, rowToSettings(row));
  stand.set(tenantId, Number(row.stand));
  return true;
}

function macheNachladen({ zustand, runner, requireState, protokoll, fristMs }) {
  const laeuft = new Map();

  async function lesen(tenantId) {
    try {
      const zeile = await runner.withClient((client) => einstellungenLesen(client, tenantId));
      if (zeile && !zustand.offen.has(tenantId) && bestaetigen(zustand, tenantId, zeile)) {
        Object.assign(settingsFor(requireState(), tenantId), zustand.bestaetigt.get(tenantId));
        zustand.abgeschaltet.delete(tenantId);
      }
      return true;
    } catch (err) {
      protokoll.error(NACHLADEN_FEHLER, err.message);
      return false;
    }
  }

  function neuerLauf(tenantId) {
    const versprechen = lesen(tenantId).finally(() => {
      if (laeuft.get(tenantId)?.versprechen === versprechen) laeuft.delete(tenantId);
    });
    laeuft.set(tenantId, { versprechen, folge: null });
    return versprechen;
  }

  function einzeln(tenantId) {
    const laufender = laeuft.get(tenantId);
    if (!laufender) return neuerLauf(tenantId);
    laufender.folge ??= laufender.versprechen.then(() => neuerLauf(tenantId));
    return laufender.folge;
  }

  function rechteAbschalten(tenantId) {
    const kopie = settingsFor(requireState(), tenantId);
    for (const schluessel of RECHTE_SCHLUESSEL) kopie[schluessel] = false;
    zustand.stand.delete(tenantId);
    zustand.abgeschaltet.add(tenantId);
  }

  return async function nachladen(tenantId) {
    if (zustand.offen.has(tenantId)) return true;
    const frist = () => protokoll.error(NACHLADEN_FEHLER, "Frist abgelaufen");
    const lesbar = await innerhalbFrist(einzeln(tenantId), fristMs, frist);
    if (!lesbar) rechteAbschalten(tenantId);
    return lesbar;
  };
}

export function macheEinstellungenSchreiber({
  einreihen,
  runner,
  requireState,
  protokoll = console,
  fristMs = EINSTELLUNGEN_NACHLADEN_FRIST_MS,
}) {
  const zustand = { stand: new Map(), bestaetigt: new Map(), offen: new Map(), abgeschaltet: new Set() };
  const { bestaetigt, offen } = zustand;

  const zuletztOffen = (tenantId) => offen.get(tenantId) === 1;

  function kopieAbgleichen(tenantId) {
    if (zuletztOffen(tenantId)) Object.assign(settingsFor(requireState(), tenantId), bestaetigt.get(tenantId));
  }

  async function erzwungenNachladen(client, tenantId) {
    try {
      bestaetigen(zustand, tenantId, await einstellungenLesen(client, tenantId));
    } catch (err) {
      protokoll.error(NACHLADEN_FEHLER, err.message);
    }
    kopieAbgleichen(tenantId);
  }

  async function lauf(client, tenantId, aenderung) {
    try {
      bestaetigen(zustand, tenantId, await einstellungenSchreiben(client, tenantId, aenderung));
    } catch (err) {
      protokoll.error(SCHREIBFEHLER, err.message);
      if (zuletztOffen(tenantId)) await erzwungenNachladen(client, tenantId);
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

  function abschaltungenOhneStand(tenantId, patch) {
    if (!zustand.abgeschaltet.has(tenantId)) return [];
    return RECHTE_SCHLUESSEL.filter((schluessel) => patch?.[schluessel] === false);
  }

  const nachladen = macheNachladen({ zustand, runner, requireState, protokoll, fristMs });
  return { schreiben, nachladen, abschaltungenOhneStand };
}
