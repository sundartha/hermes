import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";
import { nutzungAuffrischenVon } from "../../src/store/pg.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const FREMDER_TENANT = "tenant_fremd";
const JUNI = "2026-06";
const DECKE_CENT = 100;
const CFG = Object.freeze({ budgetMonthEnabled: false });
const ZEILE_SQL = "SELECT * FROM usage WHERE tenant_id = $1";
const RESERVE_SQL = `INSERT INTO budget_reservierung (call_id, tenant_id, cents, ablauf_um)
  VALUES ($1, $2, $3, now() + make_interval(secs => $4))`;

async function weitereSpeicher(anzahl) {
  const { store, runner, db } = await makePgTestStore();
  const weitere = [];
  for (let i = 1; i < anzahl; i++) {
    const speicher = makePgStore(runner);
    await speicher.init();
    weitere.push(speicher);
  }
  return { speicher: [store, ...weitere], runner, db };
}

const zeile = async (runner) =>
  (await runner.withClient((client) => client.query(ZEILE_SQL, [TENANT]))).rows[0];
const nutzung = (speicher) => speicher.load().usage[TENANT];

function kosten(speicher, cents, monat = JUNI) {
  const usage = nutzung(speicher);
  usage.costCents += cents;
  usage.spendMonthCostCents = usage.spendMonthKey === monat ? usage.spendMonthCostCents + cents : cents;
  usage.spendMonthKey = monat;
}

const reservieren = (db, { callId, tenantId = TENANT, cents, ablaufS }) =>
  db.query(RESERVE_SQL, [callId, tenantId, cents, ablaufS]);

test("Auffrischen: die Buchung eines anderen Speichers ist danach im eigenen Spiegel, ohne Neustart", async () => {
  const { speicher: [a, b] } = await weitereSpeicher(2);
  kosten(b, 40);
  await b.save();
  assert.equal(nutzung(a).costCents, 0);
  const zeitgeberDavor = process.getActiveResourcesInfo().filter((art) => art === "Timeout").length;
  assert.equal(await nutzungAuffrischenVon(a.load(), TENANT), true);
  const zeitgeberDanach = process.getActiveResourcesInfo().filter((art) => art === "Timeout").length;
  assert.equal(zeitgeberDanach, zeitgeberDavor, "die Frist laeuft nach der Antwort nicht weiter");
  assert.equal(nutzung(a).costCents, 40);
  assert.equal(nutzung(a).spendMonthCostCents, 40);
  assert.equal(nutzung(a).spendMonthKey, JUNI);
});

test("Auffrischen: die eigene ungespeicherte Buchung bleibt erhalten und wird danach genau einmal geschrieben", async () => {
  const { speicher: [a, b], runner } = await weitereSpeicher(2);
  kosten(a, 10);
  nutzung(a).calls = 2;
  kosten(b, 40);
  nutzung(b).calls = 1;
  await b.save();
  assert.equal(await nutzungAuffrischenVon(a.load(), TENANT), true);
  assert.deepEqual([nutzung(a).costCents, nutzung(a).calls, nutzung(a).spendMonthCostCents], [50, 3, 50]);
  await a.save();
  await a.save();
  const db = await zeile(runner);
  assert.deepEqual([Number(db.cost_eur), db.calls, db.spend_month_cost_cents], [0.5, 3, 50]);
});

test("Auffrischen: ein Zaehler mit Basis ungleich 0 nimmt nur den Zuwachs des anderen Speichers auf", async () => {
  const { speicher: [vorlauf], runner } = await weitereSpeicher(1);
  nutzung(vorlauf).inputTokens = 100;
  await vorlauf.save();
  const a = makePgStore(runner);
  const b = makePgStore(runner);
  await a.init();
  await b.init();
  nutzung(b).inputTokens += 7;
  await b.save();
  nutzung(a).inputTokens += 5;
  assert.equal(await nutzungAuffrischenVon(a.load(), TENANT), true);
  assert.equal(nutzung(a).inputTokens, 112);
  await a.save();
  assert.equal((await zeile(runner)).input_tokens, 112);
});

test("Auffrischen: ein Mandant ohne Zeile in der Datenbank behaelt seine eigenen Buchungen", async () => {
  const { speicher: [a], runner, db } = await weitereSpeicher(1);
  await db.query("DELETE FROM usage");
  kosten(a, 25);
  assert.equal(await nutzungAuffrischenVon(a.load(), TENANT), true);
  assert.equal(nutzung(a).costCents, 25);
  await a.save();
  assert.equal(Number((await zeile(runner)).cost_eur), 0.25);
});

test("Auffrischen: offene Reserven des Mandanten kuerzen den Rest, abgelaufene und fremde nicht, die groessere von Prozess und Datenbank zaehlt", async () => {
  const { speicher: [a], db } = await weitereSpeicher(1);
  a.setTenantBudget(TENANT, { budgetCents: DECKE_CENT, hardCapCents: DECKE_CENT });
  const rest = () => a.tenantBudgetSnapshot(TENANT, CFG).remainingCents;
  assert.equal(rest(), DECKE_CENT);
  await reservieren(db, { callId: "call_offen", cents: 60, ablaufS: 60 });
  await reservieren(db, { callId: "call_abgelaufen", cents: 30, ablaufS: -60 });
  await reservieren(db, { callId: "call_fremd", tenantId: FREMDER_TENANT, cents: 7, ablaufS: 60 });
  assert.equal(rest(), DECKE_CENT);
  assert.equal(await nutzungAuffrischenVon(a.load(), TENANT), true);
  assert.equal(rest(), 40);
  assert.equal(a.tryReserveOutboundBudget(TENANT, 80, CFG), true);
  assert.equal(rest(), 20);
  await db.query("DELETE FROM budget_reservierung");
  assert.equal(await nutzungAuffrischenVon(a.load(), TENANT), true);
  assert.equal(rest(), 20);
});

test("Auffrischen: fehlt die Tabelle der Reservierungen, ist die Antwort false und die Nutzung bleibt unveraendert", async () => {
  const { speicher: [a], db } = await weitereSpeicher(1);
  kosten(a, 15);
  await db.query("DROP TABLE budget_reservierung");
  assert.equal(await nutzungAuffrischenVon(a.load(), TENANT), false);
  assert.equal(nutzung(a).costCents, 15);
});
