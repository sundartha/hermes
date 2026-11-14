import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";
import { PRICES, tokensOf } from "../_prices.js";

const JUNI = Date.UTC(2026, 5, 15, 12);
const JULI = Date.UTC(2026, 6, 19, 10);
const DIVISOR_MICRO = 1_000_000_000_000;
const SIEBEN_ZEHNTEL_CENT = 700_000;
const RATE_EINS = 1_000_000;
const TOKENS_60_CENT = tokensOf(650_000, 0);

async function zweiSpeicher() {
  const { store: a, db, runner } = await makePgTestStore();
  const b = makePgStore(runner);
  await b.init();
  return { a, b, db, runner };
}

async function zeile(db) {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  const { rows } = await db.query(
    `SELECT input_tokens, output_tokens, calls, tts_characters, cost_eur::float8 AS cost_eur,
            spend_month_key, spend_month_cost_cents, cost_correction_micro_cents_rem,
            budget_period_key, budget_period_baseline_cents
     FROM usage WHERE tenant_id = $1`,
    [BOOTSTRAP_TENANT_ID],
  );
  return Object.fromEntries(Object.entries(rows[0]).map(([name, wert]) => [name, typeof wert === "string" && /^\d+$/.test(wert) ? Number(wert) : wert]));
}

const korrektur = (estimatedCostCents = 0) => ({
  actualCostMicroCents: SIEBEN_ZEHNTEL_CENT,
  estimatedCostCents,
  providerToBucketRateMicro: RATE_EINS,
  dataComplete: true,
});

const sichern = async (...speicher) => {
  for (const s of speicher) {
    s.save();
    await s.drainFlushes();
  }
};

test("K1: ein Speichern mit altem Spiegel ueberschreibt die Buchung des anderen Prozesses nicht", async () => {
  const { a, b, db } = await zweiSpeicher();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await a.drainFlushes();
  await sichern(a);
  b.addCalendarEvent({
    tenantId: BOOTSTRAP_TENANT_ID,
    title: "unabhaengig",
    startIso: "2026-06-15T10:00:00.000Z",
    endIso: "2026-06-15T11:00:00.000Z",
  });
  await sichern(b);
  const nutzung = await zeile(db);
  assert.equal(nutzung.spend_month_cost_cents, 40);
  assert.equal(nutzung.cost_eur, 0.4);
});

test("K2 Summe: gleichzeitige Buchungen zweier Prozesse gehen nicht verloren, je Buchungsweg", async (t) => {
  mock.timers.enable({ apis: ["Date"], now: JUNI });
  t.after(() => mock.timers.reset());
  const { a, b, db } = await zweiSpeicher();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await a.drainFlushes();
  b.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 25);
  await b.drainFlushes();
  a.addResearchFeeCostCents(BOOTSTRAP_TENANT_ID, 3);
  await a.drainFlushes();
  b.addResearchFeeCostCents(BOOTSTRAP_TENANT_ID, 5);
  await b.drainFlushes();
  a.trackUsage(BOOTSTRAP_TENANT_ID, TOKENS_60_CENT, PRICES);
  await a.drainFlushes();
  b.trackUsage(BOOTSTRAP_TENANT_ID, TOKENS_60_CENT, PRICES);
  await b.drainFlushes();
  const eigene = a.usageOf(BOOTSTRAP_TENANT_ID);
  await sichern(a, b);
  const nutzung = await zeile(db);
  const gesamt = 40 + 25 + 3 + 5 + 2 * 60;
  assert.equal(nutzung.spend_month_cost_cents, gesamt);
  assert.equal(nutzung.cost_eur, gesamt / 100);
  assert.equal(nutzung.input_tokens, 2 * eigene.inputTokens);
  assert.equal(nutzung.output_tokens, 2 * eigene.outputTokens);
  assert.equal(nutzung.spend_month_key, "2026-06");
});

test("K2 Folgesicherung: ein zweites Speichern desselben Prozesses zaehlt nichts doppelt", async () => {
  const { a, db } = await zweiSpeicher();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await a.drainFlushes();
  await sichern(a);
  await sichern(a);
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 2);
  await a.drainFlushes();
  await sichern(a);
  assert.equal((await zeile(db)).spend_month_cost_cents, 42);
});

test("K2 Monatsgrenze: Juni-Buchung neben Juli-Buchung, in beiden Reihenfolgen", async (t) => {
  t.after(() => mock.timers.reset());
  for (const juliZuerst of [false, true]) {
    mock.timers.enable({ apis: ["Date"], now: JUNI });
    const { a, b, db } = await zweiSpeicher();
    const juni = async () => {
      mock.timers.setTime(JUNI);
      a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
      await a.drainFlushes();
    };
    const juli = async () => {
      mock.timers.setTime(JULI);
      b.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 25);
      await b.drainFlushes();
    };
    for (const schritt of juliZuerst ? [juli, juni] : [juni, juli]) await schritt();
    const nutzung = await zeile(db);
    assert.equal(nutzung.cost_eur, 0.65, `Lebenszeit-Summe, juliZuerst=${juliZuerst}`);
    assert.equal(nutzung.spend_month_key, "2026-07", `Monat, juliZuerst=${juliZuerst}`);
    assert.equal(nutzung.spend_month_cost_cents, 25, `Monatszaehler, juliZuerst=${juliZuerst}`);
    mock.timers.reset();
  }
});

test("K2 Mikro-Cent-Rest: zwei Korrekturen mit je 0,7 Cent ergeben 1 Cent und 0,4 Cent Rest", async () => {
  const { a, db, runner } = await zweiSpeicher();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 10);
  await a.drainFlushes();
  const c = makePgStore(runner);
  await c.init();
  a.applyCostCorrectionCents(BOOTSTRAP_TENANT_ID, korrektur());
  await a.drainFlushes();
  c.applyCostCorrectionCents(BOOTSTRAP_TENANT_ID, korrektur());
  await c.drainFlushes();
  const nutzung = await zeile(db);
  assert.equal(nutzung.cost_eur, 0.11);
  assert.equal(nutzung.spend_month_cost_cents, 11);
  assert.equal(nutzung.cost_correction_micro_cents_rem, 0.4 * DIVISOR_MICRO);
});

test("K2 Gutschrift: eine Korrektur nach unten wird als Differenz angewandt", async () => {
  const { a, db, runner } = await zweiSpeicher();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await a.drainFlushes();
  await sichern(a);
  const c = makePgStore(runner);
  await c.init();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 5);
  await a.drainFlushes();
  c.applyCostCorrectionCents(BOOTSTRAP_TENANT_ID, korrektur(10));
  await c.drainFlushes();
  await sichern(a, c);
  const nutzung = await zeile(db);
  assert.equal(nutzung.cost_eur, 0.35);
  assert.equal(nutzung.cost_correction_micro_cents_rem, 0.7 * DIVISOR_MICRO);
});

test("K2 Gutschrift: zwei Gutschriften ueber den Stand hinaus lassen den Zaehler bei 0", async () => {
  const { a, db, runner } = await zweiSpeicher();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await a.drainFlushes();
  const c = makePgStore(runner);
  const d = makePgStore(runner);
  await c.init();
  await d.init();
  c.applyCostCorrectionCents(BOOTSTRAP_TENANT_ID, korrektur(30));
  await c.drainFlushes();
  assert.equal((await zeile(db)).cost_eur, 0.1);
  d.applyCostCorrectionCents(BOOTSTRAP_TENANT_ID, korrektur(30));
  await d.drainFlushes();
  const nutzung = await zeile(db);
  assert.equal(nutzung.cost_eur, 0);
  assert.equal(nutzung.cost_correction_micro_cents_rem, 0);
});

test("K2 Budgetzeitraum: ein Zeitraumwechsel in einem Prozess setzt Anker auf den Stand der Datenbank", async () => {
  const { a, b, db } = await zweiSpeicher();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await a.drainFlushes();
  b.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 25);
  await b.drainFlushes();
  const nutzungB = b.usageOf(BOOTSTRAP_TENANT_ID);
  nutzungB.budgetPeriodKey = "2026-06-01T00:00:00.000Z";
  nutzungB.budgetPeriodBaselineCents = nutzungB.costCents;
  await sichern(a, b);
  const nutzung = await zeile(db);
  assert.equal(nutzung.budget_period_key, "2026-06-01T00:00:00.000Z");
  assert.equal(nutzung.budget_period_baseline_cents, 65);
});

test("K2 Zaehler: Zeichen und Anrufe summieren sich ueber zwei Prozesse", async () => {
  const { a, b, db } = await zweiSpeicher();
  a.usageOf(BOOTSTRAP_TENANT_ID).ttsCharacters += 120;
  a.usageOf(BOOTSTRAP_TENANT_ID).calls += 2;
  b.usageOf(BOOTSTRAP_TENANT_ID).ttsCharacters += 30;
  b.usageOf(BOOTSTRAP_TENANT_ID).calls += 1;
  await sichern(a, b);
  const nutzung = await zeile(db);
  assert.equal(nutzung.tts_characters, 150);
  assert.equal(nutzung.calls, 3);
});

test("K1: nach einem fehlgeschlagenen Speichern geht die Buchung beim naechsten Speichern nicht verloren", async () => {
  const { runner, db } = await zweiSpeicher();
  let commitScheitert = true;
  const unzuverlaessig = {
    withClient: (arbeit) =>
      runner.withClient((client) =>
        arbeit({
          exec: client.exec,
          query: (text, parameter) => {
            if (commitScheitert && text.includes("COMMIT")) {
              commitScheitert = false;
              return Promise.reject(new Error("Commit scheitert"));
            }
            return client.query(text, parameter);
          },
        }),
      ),
  };
  const c = makePgStore(unzuverlaessig);
  await c.init();
  const stumm = mock.method(console, "error", () => {});
  c.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await c.drainFlushes().catch(() => {});
  stumm.mock.restore();
  assert.equal((await zeile(db)).cost_eur, 0);
  await sichern(c);
  assert.equal((await zeile(db)).spend_month_cost_cents, 40);
});

test("K2 ohne Monatsstempel entsteht durch den Rest-Uebertrag kein Monatszaehler", async () => {
  const { a, b, db } = await zweiSpeicher();
  a.applyCostCorrectionCents(BOOTSTRAP_TENANT_ID, korrektur());
  await a.drainFlushes();
  b.applyCostCorrectionCents(BOOTSTRAP_TENANT_ID, korrektur());
  await b.drainFlushes();
  const nutzung = await zeile(db);
  assert.equal(nutzung.cost_eur, 0.01);
  assert.equal(nutzung.spend_month_key, null);
  assert.equal(nutzung.spend_month_cost_cents, 0);
});

test("K2 Budgetanker ohne Zeitraumwechsel: Verschiebungen beider Prozesse summieren sich", async () => {
  const { a, b, db } = await zweiSpeicher();
  a.usageOf(BOOTSTRAP_TENANT_ID).budgetPeriodBaselineCents += 7;
  await sichern(a);
  b.usageOf(BOOTSTRAP_TENANT_ID).budgetPeriodBaselineCents += 3;
  await sichern(b);
  const nutzung = await zeile(db);
  assert.equal(nutzung.budget_period_baseline_cents, 10);
  assert.equal(nutzung.budget_period_key, null);
});

test("K2 Budgetzeitraum: ein aelterer Zeitraum aus dem anderen Prozess ersetzt den neueren nicht", async () => {
  const { a, b, db } = await zweiSpeicher();
  const neuer = "2026-07-01T00:00:00.000Z";
  const aelter = "2026-06-01T00:00:00.000Z";
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await a.drainFlushes();
  a.usageOf(BOOTSTRAP_TENANT_ID).budgetPeriodKey = neuer;
  a.usageOf(BOOTSTRAP_TENANT_ID).budgetPeriodBaselineCents = 40;
  await sichern(a);
  b.usageOf(BOOTSTRAP_TENANT_ID).budgetPeriodKey = aelter;
  b.usageOf(BOOTSTRAP_TENANT_ID).budgetPeriodBaselineCents = 0;
  await sichern(b);
  const nutzung = await zeile(db);
  assert.equal(nutzung.budget_period_key, neuer);
  assert.equal(nutzung.budget_period_baseline_cents, 40);
});

test("K2 neuer Mandant: erste Buchung legt die Zeile an, Speichern ohne Buchung ebenfalls", async () => {
  const { a, db } = await zweiSpeicher();
  const neu = "tenant_nutzung_neu";
  const ohne = "tenant_nutzung_ohne";
  for (const id of [neu, ohne])
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $2)`, [id, `sub-${id}`]);
  assert.equal(await a.ensureTenant(neu), true);
  assert.equal(await a.ensureTenant(ohne), true);
  a.addVoiceUsageCostCents(neu, 12);
  await sichern(a);
  const { rows } = await db.query(
    `SELECT tenant_id, spend_month_cost_cents FROM usage WHERE tenant_id IN ($1, $2) ORDER BY tenant_id`,
    [neu, ohne],
  );
  assert.deepEqual(
    rows.map((r) => [r.tenant_id, Number(r.spend_month_cost_cents)]),
    [[neu, 12], [ohne, 0]],
  );
});

test("K1: ein verworfener Speichervorgang verschiebt den Stand der Datenbank nicht", async () => {
  const { runner, db } = await zweiSpeicher();
  let commitScheitert = true;
  const unzuverlaessig = {
    withClient: (arbeit) =>
      runner.withClient((client) =>
        arbeit({
          exec: client.exec,
          query: (text, parameter) => {
            if (commitScheitert && text.includes("COMMIT")) {
              commitScheitert = false;
              return Promise.reject(new Error("Commit scheitert"));
            }
            return client.query(text, parameter);
          },
        }),
      ),
  };
  const c = makePgStore(unzuverlaessig);
  await c.init();
  const stumm = mock.method(console, "error", () => {});
  c.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await c.drainFlushes().catch(() => {});
  stumm.mock.restore();
  const nutzungC = c.usageOf(BOOTSTRAP_TENANT_ID);
  Object.assign(nutzungC, { costCents: 0, spendMonthKey: null, spendMonthCostCents: 0 });
  await sichern(c);
  c.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 5);
  await c.drainFlushes();
  assert.equal((await zeile(db)).cost_eur, 0.05);
});

test("K2 Monatswechsel nach frueherer Buchung: der neue Monat zaehlt nur seine eigene Buchung", async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["Date"], now: JUNI });
  const { a, db, runner } = await zweiSpeicher();
  a.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 40);
  await a.drainFlushes();
  const c = makePgStore(runner);
  await c.init();
  mock.timers.setTime(JULI);
  c.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 25);
  await c.drainFlushes();
  const nutzung = await zeile(db);
  assert.equal(nutzung.spend_month_key, "2026-07");
  assert.equal(nutzung.spend_month_cost_cents, 25);
  assert.equal(nutzung.cost_eur, 0.65);
});

test("K1: Speichern ohne eigene Aenderung nimmt keine Zeilensperre auf die Nutzung", async () => {
  const { runner } = await zweiSpeicher();
  const sperren = [];
  const zaehlend = {
    withClient: (arbeit) =>
      runner.withClient((client) =>
        arbeit({
          exec: client.exec,
          query: (text, parameter) => {
            if (text.includes("FOR UPDATE") && text.includes("FROM usage")) sperren.push(parameter);
            return client.query(text, parameter);
          },
        }),
      ),
  };
  const c = makePgStore(zaehlend);
  await c.init();
  await sichern(c);
  assert.deepEqual(sperren, []);
  c.addVoiceUsageCostCents(BOOTSTRAP_TENANT_ID, 4);
  await c.drainFlushes();
  assert.deepEqual(sperren, [[BOOTSTRAP_TENANT_ID]]);
});
