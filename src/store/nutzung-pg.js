import { CENTS_PER_EUR, isBookableCents, USAGE_CORRUPT_REASON } from "../begriffe/abrechnung.ts";
import { BUDGET_RESERVIERUNG_DB_FRIST_MS, NUTZUNG_AUFFRISCHEN_FRIST_MS } from "../begriffe/speicher.ts";
import { emptyUsage } from "./leerzustaende.js";
import { dbReserveSetzen, reserveUeberschreitetBudget } from "./zustand/budget.js";
import { CORRECTION_DIVISOR, laterMonotonicKey, usageFor } from "./zustand/nutzung.js";

const DIVISOR = BigInt(CORRECTION_DIVISOR);
const NULL = BigInt(0);
const ZAEHLER = ["inputTokens", "outputTokens", "calls", "ttsCharacters"];
const FELDER = [
  ...ZAEHLER,
  "costCents",
  "costCorrectionMicroCentsRem",
  "spendMonthKey",
  "spendMonthCostCents",
  "budgetPeriodKey",
  "budgetPeriodBaselineCents",
];

const ANLEGEN_SQL = `INSERT INTO usage (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`;
const SPERREN_SQL = `SELECT input_tokens, output_tokens, calls, tts_characters, cost_eur,
  spend_month_key, spend_month_cost_cents, cost_correction_micro_cents_rem,
  budget_period_key, budget_period_baseline_cents
  FROM usage WHERE tenant_id = $1 FOR UPDATE`;
const SCHREIBEN_SQL = `UPDATE usage SET input_tokens=$2, output_tokens=$3, calls=$4, tts_characters=$5,
  cost_eur=$6, spend_month_key=$7, spend_month_cost_cents=$8, cost_correction_micro_cents_rem=$9,
  budget_period_key=$10, budget_period_baseline_cents=$11 WHERE tenant_id = $1`;

const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)`;
const MANDANT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;
const LESEN_SQL = `SELECT * FROM usage WHERE tenant_id = $1`;
const OFFENE_RESERVE_SQL = `SELECT coalesce(sum(cents), 0)::float8 AS cents FROM budget_reservierung
  WHERE tenant_id = $1 AND ablauf_um > now()`;

const standJeZustand = new WeakMap();

function standVon(state) {
  if (!standJeZustand.has(state)) standJeZustand.set(state, { geladen: new Map(), vorgemerkt: new Map() });
  return standJeZustand.get(state);
}

const bildVon = (usage) => Object.fromEntries(FELDER.map((feld) => [feld, usage[feld]]));

export function nutzungGeladen(state, tenantId, usage) {
  standVon(state).geladen.set(tenantId, bildVon(usage));
}

export function nutzungBestaetigen(state) {
  const stand = standVon(state);
  for (const [tenantId, bild] of stand.vorgemerkt) stand.geladen.set(tenantId, bild);
  stand.vorgemerkt.clear();
}

export function nutzungVerwerfen(state) {
  standVon(state).vorgemerkt.clear();
}

export function hydratedCostCents(costEur) {
  const cents = Math.round(Number(costEur) * CENTS_PER_EUR);
  if (isBookableCents(cents)) return cents;
  console.error(`[pg] grund=${USAGE_CORRUPT_REASON} cost_eur=${costEur} -> costCents=0`);
  return 0;
}

function ausZeile(zeile) {
  return {
    inputTokens: Number(zeile.input_tokens),
    outputTokens: Number(zeile.output_tokens),
    calls: Number(zeile.calls),
    ttsCharacters: Number(zeile.tts_characters),
    costCents: hydratedCostCents(zeile.cost_eur),
    spendMonthKey: zeile.spend_month_key ?? null,
    spendMonthCostCents: Number(zeile.spend_month_cost_cents),
    costCorrectionMicroCentsRem: Number(zeile.cost_correction_micro_cents_rem),
    budgetPeriodKey: zeile.budget_period_key ?? null,
    budgetPeriodBaselineCents: Number(zeile.budget_period_baseline_cents),
  };
}

export { ausZeile as nutzungAusZeile };

const zuwachs = (feld, { db, aktuell, basis }) => Math.max(0, db[feld] + aktuell[feld] - basis[feld]);

function kostenZusammen({ db, aktuell, basis }) {
  const erwartet = db.costCents + aktuell.costCents - basis.costCents;
  const rest =
    db.costCorrectionMicroCentsRem + aktuell.costCorrectionMicroCentsRem - basis.costCorrectionMicroCentsRem;
  const gesamt = BigInt(erwartet) * DIVISOR + BigInt(rest);
  if (gesamt < NULL) return { costCents: 0, costCorrectionMicroCentsRem: 0, uebertrag: 0 };
  const costCents = Number(gesamt / DIVISOR);
  return {
    costCents,
    costCorrectionMicroCentsRem: Number(gesamt % DIVISOR),
    uebertrag: costCents - Math.max(erwartet, 0),
  };
}

function monatZusammen({ db, aktuell, basis }, uebertrag) {
  const gewechselt = aktuell.spendMonthKey !== basis.spendMonthKey;
  const eigen = gewechselt ? aktuell.spendMonthCostCents : aktuell.spendMonthCostCents - basis.spendMonthCostCents;
  const schluessel = laterMonotonicKey(db.spendMonthKey, aktuell.spendMonthKey);
  const vorhanden = schluessel === db.spendMonthKey ? db.spendMonthCostCents : 0;
  const zaehlt = schluessel !== null && schluessel === aktuell.spendMonthKey;
  return { spendMonthKey: schluessel, spendMonthCostCents: Math.max(0, vorhanden + (zaehlt ? eigen + uebertrag : 0)) };
}

function zeitraumZusammen(stand, costCents) {
  const { db, aktuell, basis } = stand;
  if (aktuell.budgetPeriodKey === basis.budgetPeriodKey)
    return { budgetPeriodKey: db.budgetPeriodKey, budgetPeriodBaselineCents: zuwachs("budgetPeriodBaselineCents", stand) };
  const schluessel = laterMonotonicKey(db.budgetPeriodKey, aktuell.budgetPeriodKey);
  const anker =
    schluessel === db.budgetPeriodKey
      ? db.budgetPeriodBaselineCents
      : costCents - (aktuell.costCents - aktuell.budgetPeriodBaselineCents);
  return { budgetPeriodKey: schluessel, budgetPeriodBaselineCents: anker };
}

function zusammenfuehren(stand) {
  const kosten = kostenZusammen(stand);
  return {
    ...Object.fromEntries(ZAEHLER.map((feld) => [feld, zuwachs(feld, stand)])),
    costCents: kosten.costCents,
    costCorrectionMicroCentsRem: kosten.costCorrectionMicroCentsRem,
    ...monatZusammen(stand, kosten.uebertrag),
    ...zeitraumZusammen(stand, kosten.costCents),
  };
}

const unveraendert = (aktuell, basis) => FELDER.every((feld) => aktuell[feld] === basis[feld]);

export async function nutzungSchreiben(client, state, tenantId) {
  const aktuell = bildVon(usageFor(state, tenantId));
  const stand = standVon(state);
  const basis = stand.geladen.get(tenantId) ?? bildVon(emptyUsage());
  await client.query(ANLEGEN_SQL, [tenantId]);
  if (unveraendert(aktuell, basis)) return;
  const { rows } = await client.query(SPERREN_SQL, [tenantId]);
  const neu = zusammenfuehren({ db: ausZeile(rows[0]), aktuell, basis });
  await client.query(SCHREIBEN_SQL, [
    tenantId,
    neu.inputTokens,
    neu.outputTokens,
    neu.calls,
    neu.ttsCharacters,
    neu.costCents / CENTS_PER_EUR,
    neu.spendMonthKey,
    neu.spendMonthCostCents,
    neu.costCorrectionMicroCentsRem,
    neu.budgetPeriodKey,
    neu.budgetPeriodBaselineCents,
  ]);
  stand.vorgemerkt.set(tenantId, aktuell);
}

export async function inMandantTransaktion(client, tenantId, arbeit) {
  await client.query("BEGIN");
  try {
    await client.query(FRIST_SQL, [String(BUDGET_RESERVIERUNG_DB_FRIST_MS)]);
    await client.query(MANDANT_SQL, [tenantId]);
    const ergebnis = await arbeit(client);
    await client.query("COMMIT");
    return ergebnis;
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    throw fehler;
  }
}

function dbStandUebernehmen(state, tenantId, { zeile, reserveCents }) {
  const db = zeile ? ausZeile(zeile) : bildVon(emptyUsage());
  const aktuell = usageFor(state, tenantId);
  const stand = standVon(state);
  const basis = stand.geladen.get(tenantId) ?? bildVon(emptyUsage());
  Object.assign(aktuell, zusammenfuehren({ db, aktuell: bildVon(aktuell), basis }));
  stand.geladen.set(tenantId, db);
  dbReserveSetzen(state, tenantId, reserveCents);
}

function nutzungLesen(client, state, tenantId) {
  return inMandantTransaktion(client, tenantId, async () => {
    const { rows } = await client.query(LESEN_SQL, [tenantId]);
    const offen = await client.query(OFFENE_RESERVE_SQL, [tenantId]);
    dbStandUebernehmen(state, tenantId, { zeile: rows[0], reserveCents: offen.rows[0].cents });
  });
}

function binnenFrist(arbeit) {
  let uhr;
  const abgelaufen = new Promise((fertig) => {
    uhr = setTimeout(() => {
      console.error("[nutzung] Auffrischung nicht binnen der Frist, Pruefung mit dem Stand des Prozesses");
      fertig(false);
    }, NUTZUNG_AUFFRISCHEN_FRIST_MS);
  });
  return Promise.race([arbeit, abgelaufen]).finally(() => clearTimeout(uhr));
}

export function nutzungAuffrischen({ einreihen, state, tenantId }) {
  const gelesen = einreihen((client) => nutzungLesen(client, state, tenantId)).then(
    () => true,
    (fehler) => {
      console.error("[nutzung] Auffrischung fehlgeschlagen, Pruefung mit dem Stand des Prozesses:", fehler.message);
      return false;
    },
  );
  return binnenFrist(gelesen);
}

const offeneReserve = (state, tenantId) => state.dbReserven?.[tenantId] ?? 0;

export function reserveSpiegelVersuchen(state, { tenantId, reserveCents, cfg, nowIso }) {
  if (!isBookableCents(reserveCents)) return false;
  if (reserveUeberschreitetBudget(state, { tenantId, reserveCents, cfg, nowIso })) return false;
  dbReserveSetzen(state, tenantId, offeneReserve(state, tenantId) + reserveCents);
  return true;
}

export function reserveSpiegelFreigeben(state, tenantId, cents) {
  if (!isBookableCents(cents)) return false;
  dbReserveSetzen(state, tenantId, Math.max(0, offeneReserve(state, tenantId) - cents));
  return true;
}

export function anrufReserveSpiegelFreigeben(state, call) {
  if (!call || !call.reserveCents || call.reserveReleased) return false;
  return reserveSpiegelFreigeben(state, call.tenantId, call.reserveCents);
}

export const reserveSpiegelOffen = offeneReserve;
