import assert from "node:assert/strict";
import { test } from "node:test";

import { budgetReservierung, makePostgresBudgetReserve } from "../../src/store.js";
import { makePgTestStore } from "../pg-helpers.js";

const MANDANT = "owner";
const ANDERER_MANDANT = "tenant_anderer";
const CENT_JE_EURO = 100;
const AKTUELLER_MONAT = new Date().toISOString().slice(0, 7);
const ALTER_MONAT = "2020-01";
const ZEILEN_SQL = "SELECT call_id, tenant_id, cents::int AS cents FROM budget_reservierung ORDER BY call_id";
const VERBRAUCH_SQL = `INSERT INTO usage (tenant_id, cost_eur, spend_month_key, spend_month_cost_cents, budget_period_key, budget_period_baseline_cents)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (tenant_id) DO UPDATE SET cost_eur = $2, spend_month_key = $3, spend_month_cost_cents = $4,
    budget_period_key = $5, budget_period_baseline_cents = $6`;
const ALTE_RESERVE_SQL = `INSERT INTO budget_reservierung (call_id, tenant_id, cents, ablauf_um)
  VALUES ($1, $2, $3, now() + $4::interval)`;

async function aufbau() {
  const { runner } = await makePgTestStore();
  const sql = (text, parameter) => runner.withClient((client) => client.query(text, parameter));
  await sql("INSERT INTO tenant (id, status, owner_name, first_name) VALUES ($1, 'active', 'Anderer', 'Anderer')", [ANDERER_MANDANT]);
  return { reserve: await makePostgresBudgetReserve(runner), sql };
}

const verbrauch = (sql, { cent, monat = null, monatCent = 0, zeitraum = null, anker = 0, tenantId = MANDANT }) =>
  sql(VERBRAUCH_SQL, [tenantId, cent / CENT_JE_EURO, monat, monatCent, zeitraum, anker]);

const anfrage = (aenderung = {}) => ({
  callId: "call_neu",
  tenantId: MANDANT,
  cents: 60,
  capCents: 100,
  ablaufS: 60,
  cfg: { budgetMonthEnabled: false },
  ...aenderung,
});

const FAELLE = [
  { name: "ohne Verbrauch passt die Reserve unter die Decke", cent: 0, erwartet: { reserviert: true } },
  { name: "Verbrauch plus Reserve genau auf der Decke wird angenommen", cent: 40, erwartet: { reserviert: true } },
  {
    name: "ein Cent ueber der Decke wird mit dem verbleibenden Rest abgelehnt",
    cent: 41,
    erwartet: { reserviert: false, grund: "decke", verbleibendCents: 59 },
  },
  {
    name: "Verbrauch ueber der Decke ergibt einen negativen Rest",
    cent: 130,
    erwartet: { reserviert: false, grund: "decke", verbleibendCents: -30 },
  },
  {
    name: "Zeitraum-Achse zaehlt nur den Verbrauch seit dem Anker",
    cent: 80,
    zeitraum: "2026-01-01T00:00:00.000Z",
    anker: 50,
    erwartet: { reserviert: true },
  },
  {
    name: "Monats-Achse zaehlt den Monatsverbrauch statt des Gesamtverbrauchs",
    cent: 300,
    monat: AKTUELLER_MONAT,
    monatCent: 70,
    cfg: { budgetMonthEnabled: true },
    erwartet: { reserviert: false, grund: "decke", verbleibendCents: 30 },
  },
  {
    name: "Monats-Achse zaehlt einen alten Monat als null",
    cent: 300,
    monat: ALTER_MONAT,
    monatCent: 70,
    cfg: { budgetMonthEnabled: true },
    erwartet: { reserviert: true },
  },
];

for (const fall of FAELLE) {
  test(`reservieren: ${fall.name}`, async () => {
    const { reserve, sql } = await aufbau();
    await verbrauch(sql, fall);
    const ergebnis = await reserve.reservieren(anfrage({ ...(fall.cfg ? { cfg: fall.cfg } : {}) }));
    assert.deepEqual(ergebnis, fall.erwartet);
    const { rows } = await sql(ZEILEN_SQL);
    assert.equal(rows.length, fall.erwartet.reserviert ? 1 : 0);
  });
}

test("reservieren: offene Reserven desselben Mandanten zaehlen mit, die eines anderen nicht", async () => {
  const { reserve, sql } = await aufbau();
  await sql(ALTE_RESERVE_SQL, ["call_offen", MANDANT, 50, "1 hour"]);
  await sql(ALTE_RESERVE_SQL, ["call_fremd", ANDERER_MANDANT, 90, "1 hour"]);
  assert.deepEqual(await reserve.reservieren(anfrage({ cents: 51 })), {
    reserviert: false,
    grund: "decke",
    verbleibendCents: 50,
  });
  assert.deepEqual(await reserve.reservieren(anfrage({ cents: 50 })), { reserviert: true });
});

test("reservieren: eine abgelaufene Reserve zaehlt nicht mehr und wird entfernt", async () => {
  const { reserve, sql } = await aufbau();
  await sql(ALTE_RESERVE_SQL, ["call_abgelaufen", MANDANT, 100, "-1 minute"]);
  await sql(ALTE_RESERVE_SQL, ["call_fremd_abgelaufen", ANDERER_MANDANT, 100, "-1 minute"]);
  assert.deepEqual(await reserve.reservieren(anfrage()), { reserviert: true });
  const { rows } = await sql(ZEILEN_SQL);
  assert.deepEqual(rows, [
    { call_id: "call_fremd_abgelaufen", tenant_id: ANDERER_MANDANT, cents: 100 },
    { call_id: "call_neu", tenant_id: MANDANT, cents: 60 },
  ]);
});

test("reservieren: die Ablauffrist ist die uebergebene Zahl Sekunden", async () => {
  const { reserve, sql } = await aufbau();
  await reserve.reservieren(anfrage({ ablaufS: 77 }));
  const { rows } = await sql("SELECT EXTRACT(EPOCH FROM ablauf_um - angelegt_um)::int AS frist_s FROM budget_reservierung");
  assert.deepEqual(rows, [{ frist_s: 77 }]);
});

test("reservieren: dieselbe Anruf-Kennung zweimal wird abgelehnt statt doppelt gezaehlt", async () => {
  const { reserve, sql } = await aufbau();
  assert.deepEqual(await reserve.reservieren(anfrage({ cents: 10 })), { reserviert: true });
  assert.deepEqual(await reserve.reservieren(anfrage({ cents: 10 })), { reserviert: false, grund: "db" });
  assert.equal((await sql(ZEILEN_SQL)).rows.length, 1);
});

test("freigeben: je Anruf und Mandant, zweimal ist wie einmal, andere Reserven bleiben", async () => {
  const { reserve, sql } = await aufbau();
  await reserve.reservieren(anfrage({ callId: "call_a", cents: 30 }));
  await reserve.reservieren(anfrage({ callId: "call_b", cents: 30 }));
  await reserve.reservieren(anfrage({ callId: "call_c", tenantId: ANDERER_MANDANT, cents: 30 }));
  await reserve.freigeben({ callId: "call_a", tenantId: MANDANT });
  await reserve.freigeben({ callId: "call_a", tenantId: MANDANT });
  await reserve.freigeben({ callId: "call_c", tenantId: MANDANT });
  await reserve.freigeben({ callId: "call_unbekannt", tenantId: MANDANT });
  assert.deepEqual((await sql(ZEILEN_SQL)).rows, [
    { call_id: "call_b", tenant_id: MANDANT, cents: 30 },
    { call_id: "call_c", tenant_id: ANDERER_MANDANT, cents: 30 },
  ]);
});

test("reservieren: fehlt die Tabelle, wird abgelehnt und der Grund steht im Log", async (t) => {
  const { reserve, sql } = await aufbau();
  await sql("DROP TABLE budget_reservierung");
  const fehler = t.mock.method(console, "error", () => {});
  assert.deepEqual(await reserve.reservieren(anfrage()), { reserviert: false, grund: "db" });
  const [aufruf] = fehler.mock.calls;
  const [kopf, ursache] = aufruf.arguments;
  assert.equal(kopf, "[budget-reservierung] Datenbank nicht erreichbar, abgelehnt:");
  assert.match(ursache, /budget_reservierung/);
});

test("freigeben: fehlt die Tabelle, bleibt der Fehler im Log und nichts wird geworfen", async (t) => {
  const { reserve, sql } = await aufbau();
  await sql("DROP TABLE budget_reservierung");
  const fehler = t.mock.method(console, "error", () => {});
  assert.equal(await reserve.freigeben({ callId: "call_a", tenantId: MANDANT }), undefined);
  const [aufruf] = fehler.mock.calls;
  const [kopf] = aufruf.arguments;
  assert.equal(kopf, "[budget-reservierung] Reserve nicht freigegeben, bleibt bis zum Ablauf:");
});

test("ohne geoeffneten Postgres-Speicher reserviert die Fassade ohne Datenbank und gibt nichts frei", async () => {
  assert.deepEqual(await budgetReservierung.reservieren(anfrage()), { reserviert: true });
  assert.equal(await budgetReservierung.freigeben({ callId: "call_a", tenantId: MANDANT }), undefined);
});
