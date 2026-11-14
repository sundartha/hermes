import { CENTS_PER_EUR } from "../begriffe/abrechnung.js";
import { emptyUsage } from "./leerzustaende.js";
import { CORRECTION_DIVISOR, laterMonotonicKey, usageFor } from "./zustand/nutzung.js";

const DIVISOR = BigInt(CORRECTION_DIVISOR);
const NULL = BigInt(0);
const ZAEHLER = ["inputTokens", "outputTokens", "calls", "ttsCharacters"];
const GESCHRIEBENE_FELDER = [
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

const standJeZustand = new WeakMap();

function standVon(state) {
  if (!standJeZustand.has(state)) standJeZustand.set(state, { basis: new Map(), offen: new Map() });
  return standJeZustand.get(state);
}

function festhalten(usage) {
  return Object.fromEntries(GESCHRIEBENE_FELDER.map((feld) => [feld, usage[feld]]));
}

export function nutzungBasisSetzen(state, tenantId, usage) {
  standVon(state).basis.set(tenantId, festhalten(usage));
}

export function nutzungBestaetigen(state) {
  const stand = standVon(state);
  for (const [tenantId, bild] of stand.offen) stand.basis.set(tenantId, bild);
  stand.offen.clear();
}

export function nutzungVerwerfen(state) {
  standVon(state).offen.clear();
}

function ausZeile(zeile) {
  return {
    inputTokens: Number(zeile.input_tokens),
    outputTokens: Number(zeile.output_tokens),
    calls: Number(zeile.calls),
    ttsCharacters: Number(zeile.tts_characters),
    costCents: Math.round(Number(zeile.cost_eur) * CENTS_PER_EUR),
    spendMonthKey: zeile.spend_month_key ?? null,
    spendMonthCostCents: Number(zeile.spend_month_cost_cents),
    costCorrectionMicroCentsRem: Number(zeile.cost_correction_micro_cents_rem),
    budgetPeriodKey: zeile.budget_period_key ?? null,
    budgetPeriodBaselineCents: Number(zeile.budget_period_baseline_cents),
  };
}

const zuwachs = (feld, { db, aktuell, basis }) => Math.max(0, db[feld] + aktuell[feld] - basis[feld]);

function kostenZusammen({ db, aktuell, basis }) {
  const erwartet = db.costCents + aktuell.costCents - basis.costCents;
  const rest = db.costCorrectionMicroCentsRem + aktuell.costCorrectionMicroCentsRem - basis.costCorrectionMicroCentsRem;
  const gesamt = BigInt(erwartet) * DIVISOR + BigInt(rest);
  if (gesamt < NULL) return { costCents: 0, costCorrectionMicroCentsRem: 0, uebertrag: 0 };
  const costCents = Number(gesamt / DIVISOR);
  return { costCents, costCorrectionMicroCentsRem: Number(gesamt % DIVISOR), uebertrag: costCents - erwartet };
}

function monatZusammen({ db, aktuell, basis }, uebertrag) {
  const wechsel = aktuell.spendMonthKey !== basis.spendMonthKey;
  const beitrag = (wechsel ? aktuell.spendMonthCostCents : aktuell.spendMonthCostCents - basis.spendMonthCostCents) + uebertrag;
  const schluessel = laterMonotonicKey(db.spendMonthKey, aktuell.spendMonthKey);
  const vorhanden = schluessel === db.spendMonthKey ? db.spendMonthCostCents : 0;
  const zaehlt = schluessel !== null && schluessel === aktuell.spendMonthKey;
  return { spendMonthKey: schluessel, spendMonthCostCents: Math.max(0, vorhanden + (zaehlt ? beitrag : 0)) };
}

function zeitraumZusammen(stand, costCents) {
  const { db, aktuell, basis } = stand;
  if (aktuell.budgetPeriodKey === basis.budgetPeriodKey)
    return { budgetPeriodKey: db.budgetPeriodKey, budgetPeriodBaselineCents: zuwachs("budgetPeriodBaselineCents", stand) };
  const schluessel = laterMonotonicKey(db.budgetPeriodKey, aktuell.budgetPeriodKey);
  return {
    budgetPeriodKey: schluessel,
    budgetPeriodBaselineCents: schluessel === db.budgetPeriodKey ? db.budgetPeriodBaselineCents : costCents,
  };
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

const unveraendert = (aktuell, basis) => GESCHRIEBENE_FELDER.every((feld) => aktuell[feld] === basis[feld]);

export async function nutzungSchreiben(client, state, tenantId) {
  const aktuell = festhalten(usageFor(state, tenantId));
  const stand = standVon(state);
  const basis = stand.basis.get(tenantId) ?? festhalten(emptyUsage());
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
  stand.offen.set(tenantId, aktuell);
}
