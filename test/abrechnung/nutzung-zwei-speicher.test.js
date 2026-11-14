import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const JUNI = "2026-06";
const JULI = "2026-07";
const MIKRO_JE_CENT = 1_000_000;
const DIVISOR = MIKRO_JE_CENT * MIKRO_JE_CENT;
const ZEITRAUM_ALT = "2026-06-01T00:00:00.000Z";
const ZEITRAUM_NEU = "2026-07-01T00:00:00.000Z";
const ZEILE_SQL = "SELECT * FROM usage WHERE tenant_id = $1";

async function weitereSpeicher(anzahl) {
  const { store, runner } = await makePgTestStore();
  const weitere = [];
  for (let i = 1; i < anzahl; i++) {
    const speicher = makePgStore(runner);
    await speicher.init();
    weitere.push(speicher);
  }
  return { speicher: [store, ...weitere], runner };
}

async function zeile(runner) {
  const { rows } = await runner.withClient((client) => client.query(ZEILE_SQL, [TENANT]));
  return Object.fromEntries(
    Object.entries(rows[0]).map(([name, wert]) => [name, typeof wert === "string" && /^[\d.]+$/.test(wert) ? Number(wert) : wert]),
  );
}

const nutzung = (speicher) => speicher.load().usage[TENANT];

function kosten(speicher, cents, monat = JUNI) {
  const usage = nutzung(speicher);
  usage.costCents += cents;
  usage.spendMonthCostCents = usage.spendMonthKey === monat ? usage.spendMonthCostCents + cents : cents;
  usage.spendMonthKey = monat;
}

function korrektur(speicher, cent) {
  nutzung(speicher).costCorrectionMicroCentsRem += Math.round(cent * DIVISOR);
}

test("K1: ein Speichern ohne eigene Buchung mit altem Spiegel ueberschreibt die Buchung des anderen Prozesses nicht", async () => {
  const { speicher: [a, b], runner } = await weitereSpeicher(2);
  kosten(a, 40);
  await a.save();
  await b.save();
  assert.equal((await zeile(runner)).cost_eur, 0.4);
});

test("K2 Summe: gleichzeitige Buchungen zweier Prozesse gehen nicht verloren", async () => {
  const { speicher: [a, b], runner } = await weitereSpeicher(2);
  kosten(a, 40);
  Object.assign(nutzung(a), { inputTokens: 10, outputTokens: 20, calls: 1, ttsCharacters: 100 });
  kosten(b, 50);
  Object.assign(nutzung(b), { inputTokens: 1, outputTokens: 2, calls: 3, ttsCharacters: 50 });
  await a.save();
  await b.save();
  const db = await zeile(runner);
  assert.equal(db.cost_eur, 0.9);
  assert.deepEqual(
    [db.input_tokens, db.output_tokens, db.calls, db.tts_characters, db.spend_month_cost_cents],
    [11, 22, 4, 150, 90],
  );
});

test("K2 Folgesicherung: ein zweites Speichern desselben Prozesses zaehlt nichts doppelt", async () => {
  const { speicher: [a, b], runner } = await weitereSpeicher(2);
  kosten(a, 40);
  nutzung(a).calls = 2;
  await a.save();
  await a.save();
  kosten(b, 10);
  await b.save();
  await a.save();
  const db = await zeile(runner);
  assert.deepEqual([db.cost_eur, db.calls, db.spend_month_cost_cents], [0.5, 2, 50]);
});

test("K2 Zaehler mit Basis ungleich 0: nur der Zuwachs des Speichernden kommt hinzu", async () => {
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
  await a.save();
  assert.equal((await zeile(runner)).input_tokens, 112);
});

test("K2 Monatsgrenze: Juni-Buchung neben Juli-Buchung, in beiden Reihenfolgen", async () => {
  for (const julizuerst of [true, false]) {
    const { speicher: [a, b], runner } = await weitereSpeicher(2);
    kosten(a, 30, JUNI);
    kosten(b, 50, JULI);
    const [erst, dann] = julizuerst ? [b, a] : [a, b];
    await erst.save();
    await dann.save();
    const db = await zeile(runner);
    assert.deepEqual(
      [db.cost_eur, db.spend_month_key, db.spend_month_cost_cents],
      [0.8, "2026-07", 50],
      `julizuerst=${julizuerst}`,
    );
  }
});

test("K2 Monatswechsel nach frueherer Buchung: der neue Monat zaehlt nur seine eigene Buchung", async () => {
  const { speicher: [a], runner } = await weitereSpeicher(1);
  kosten(a, 30, JUNI);
  await a.save();
  kosten(a, 20, JULI);
  await a.save();
  const db = await zeile(runner);
  assert.deepEqual([db.cost_eur, db.spend_month_key, db.spend_month_cost_cents], [0.5, "2026-07", 20]);
});

test("K2 Mikro-Cent-Rest: zwei Korrekturen mit je 0,7 Cent ergeben 1 Cent und 0,4 Cent Rest", async () => {
  const { speicher: [a, b], runner } = await weitereSpeicher(2);
  korrektur(a, 0.7);
  korrektur(b, 0.7);
  await a.save();
  await b.save();
  const db = await zeile(runner);
  assert.equal(db.cost_eur, 0.01);
  assert.equal(db.cost_correction_micro_cents_rem, 0.4 * DIVISOR);
  assert.deepEqual([db.spend_month_key, db.spend_month_cost_cents], [null, 0]);
});

test("K2 Mikro-Cent-Rest mit Monatsstempel: der Uebertrag zaehlt im Monat des Speichernden", async () => {
  const { speicher: [vorlauf], runner } = await weitereSpeicher(1);
  kosten(vorlauf, 10);
  await vorlauf.save();
  const a = makePgStore(runner);
  const b = makePgStore(runner);
  await a.init();
  await b.init();
  korrektur(a, 0.7);
  korrektur(b, 0.7);
  await a.save();
  await b.save();
  const db = await zeile(runner);
  assert.deepEqual([db.cost_eur, db.spend_month_key, db.spend_month_cost_cents], [0.11, "2026-06", 11]);
});

test("K2 Mikro-Cent-Rest: Rest der Datenbank und eigener Rest addieren sich", async () => {
  const { speicher: [a, c], runner } = await weitereSpeicher(2);
  korrektur(c, 0.3);
  await c.save();
  korrektur(a, 0.2);
  await a.save();
  const db = await zeile(runner);
  assert.equal(db.cost_eur, 0);
  assert.equal(db.cost_correction_micro_cents_rem, 0.5 * DIVISOR);
});

test("K2 Mikro-Cent-Rest: ein Rest in der Basis wird nicht doppelt gezaehlt", async () => {
  const { speicher: [vorlauf], runner } = await weitereSpeicher(1);
  korrektur(vorlauf, 0.1);
  await vorlauf.save();
  const a = makePgStore(runner);
  const b = makePgStore(runner);
  await a.init();
  await b.init();
  korrektur(b, 0.3);
  await b.save();
  korrektur(a, 0.2);
  await a.save();
  assert.equal((await zeile(runner)).cost_correction_micro_cents_rem, 0.6 * DIVISOR);
});

test("K2 Gutschrift: zwei Gutschriften ueber den Stand hinaus lassen den Zaehler bei 0", async () => {
  const { speicher: [vorlauf], runner } = await weitereSpeicher(1);
  kosten(vorlauf, 10);
  await vorlauf.save();
  const a = makePgStore(runner);
  const b = makePgStore(runner);
  await a.init();
  await b.init();
  nutzung(a).costCents -= 10;
  nutzung(b).costCents -= 10;
  await a.save();
  await b.save();
  assert.equal((await zeile(runner)).cost_eur, 0);
});

test("K2 Budgetzeitraum: ein aelterer Zeitraum aus dem anderen Prozess ersetzt den neueren nicht", async () => {
  const { speicher: [a, c], runner } = await weitereSpeicher(2);
  Object.assign(nutzung(c), { costCents: 100, budgetPeriodKey: ZEITRAUM_NEU, budgetPeriodBaselineCents: 70 });
  await c.save();
  Object.assign(nutzung(a), { costCents: 30, budgetPeriodKey: ZEITRAUM_ALT, budgetPeriodBaselineCents: 10 });
  await a.save();
  const db = await zeile(runner);
  assert.equal(db.budget_period_key, ZEITRAUM_NEU);
  assert.equal(db.budget_period_baseline_cents, 70);
  assert.equal(db.cost_eur, 1.3);
});

test("K2 Budgetzeitraum: ein Zeitraumwechsel setzt den Anker auf Stand der Datenbank minus eigener Verbrauch", async () => {
  const { speicher: [a, b], runner } = await weitereSpeicher(2);
  kosten(b, 40);
  await b.save();
  kosten(a, 25);
  Object.assign(nutzung(a), { budgetPeriodKey: ZEITRAUM_NEU, budgetPeriodBaselineCents: 0 });
  await a.save();
  const db = await zeile(runner);
  assert.equal(db.budget_period_key, ZEITRAUM_NEU);
  assert.equal(db.budget_period_baseline_cents, 40);
});

test("K2 Budgetanker ohne Zeitraumwechsel: Verschiebungen beider Prozesse summieren sich", async () => {
  const { speicher: [a, b], runner } = await weitereSpeicher(2);
  nutzung(a).budgetPeriodBaselineCents = 3;
  nutzung(b).budgetPeriodBaselineCents = 7;
  await a.save();
  await b.save();
  assert.equal((await zeile(runner)).budget_period_baseline_cents, 10);
});

test("K1: nach einem fehlgeschlagenen Speichern geht die Buchung beim naechsten Speichern nicht verloren", async () => {
  const { speicher: [a], runner } = await weitereSpeicher(1);
  kosten(a, 40);
  await a.save(() => {
    throw new Error("Abbruch vor dem Schreiben");
  });
  assert.equal((await zeile(runner)).cost_eur, 0);
  await a.save();
  assert.equal((await zeile(runner)).cost_eur, 0.4);
});

test("K2 neuer Mandant: das Speichern ohne Buchung legt die Zeile an, ohne Werte zu aendern", async () => {
  const { speicher: [a], runner } = await weitereSpeicher(1);
  const db = await zeile(runner);
  assert.deepEqual([db.cost_eur, db.calls, db.input_tokens, db.spend_month_key], [0, 0, 0, null]);
  await a.save();
  assert.equal((await zeile(runner)).cost_eur, 0);
});

for (const kaputt of ["NaN", "Infinity"]) {
  test(`K2 korrupter cost_eur ${kaputt}: heilt beim Speichern, die Buchung wird gespeichert`, async () => {
    const { runner } = await weitereSpeicher(1);
    await runner.withClient((client) => client.query("UPDATE usage SET cost_eur = $2 WHERE tenant_id = $1", [TENANT, kaputt]));
    const neu = makePgStore(runner);
    await neu.init();
    kosten(neu, 5);
    nutzung(neu).calls += 1;
    await neu.save();
    const db = await zeile(runner);
    assert.deepEqual([db.cost_eur, db.calls], [0.05, 1]);
  });
}
