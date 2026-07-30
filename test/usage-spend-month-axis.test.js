// P4 (PLAN-BUDGET-AXES): additive, INERTE Spend-Monat-Achse (spendMonthKey/
// spendMonthCostCents) NEBEN dem unveraenderten Lebenszeit-Zaehler costCents. Kein
// Gate liest diese Achse in dieser Phase - der Flip ist P7. Diese Datei ist die
// EINZIGE Testdatei-Aenderung der Phase (0 Bestandstests angefasst). Muster wie
// test/budget-nan-fail-closed.test.js: Ops-Ebene + PGlite in einer Datei, kein
// Netz, kein Server (F.I.R.S.T.).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  makeDefaultState,
  usageFor,
  trackUsage,
  addVoiceUsageCostCents,
  spendMonthUsageCents,
  budgetExceeded,
  reserveExceedsBudget,
  tryReserveOutboundBudget,
} from "../src/store/state-ops.js";
import { emptyUsage, BOOTSTRAP_TENANT_ID, MICRO_CENTS_PER_CENT } from "../src/store/defaults.js";
import { makePgStore } from "../src/store/pg.js";
import { applySchema } from "../src/db/migrate.js";
import { makePgTestStore } from "./pg-helpers.js";
import { tempDataDir } from "./helpers.js";
import { PRICES, tokensOf } from "./_prices.js";

const TENANT_A = "tenant_a";
const JUNE_ISO = "2026-06-15T12:00:00.000Z"; // Schluessel '2026-06'
const JULY_ISO = "2026-07-19T10:00:00.000Z"; // Schluessel '2026-07'
const SEPT_ISO = "2026-09-01T00:00:00.000Z"; // Schluessel '2026-09' (Zukunft ggue. JULY_ISO)

// Tokens, deren Preis (billiges Testmodell, s. _prices.js: inPerMTok=1.0, usdToEur=0.93)
// auf GENAU 60 Cent Cent-Uebertrag rundet: microInc = round(650000/1e6 * 1.0 * 0.93 * 100
// * 1e6) = round(60.450.000) = 60.450.000 -> floor/1e6 = 60, Rest 450.000. Werkzeug fuer
// die Cent-Uebertrags-Tests unten, kein Produktionswert.
const TOKENS_60_CENT = tokensOf(650_000, 0);
const CENT_TRANSFER = 60;
const REMAINDER_AFTER_TRANSFER = 450_000;

// Sub-Cent-Turn (< 1 Cent): microInc = round(1000/1e6 * 1.0 * 0.93 * 100 * 1e6) = 93.000.
const TOKENS_SUBCENT = tokensOf(1_000, 0);
const MICRO_PER_SUBCENT_TURN = 93_000;

let config;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  config = (await import("../src/config.js")).config;
});

let jsonSeq = 0;
// Frischer json.js-Modul-Import auf einem neuen temp-DATA_DIR (Muster
// test/store-json-migrate-shapes.test.js: dynamischer Import mit Query-Suffix, damit
// jeder Aufruf ein eigenes Modul-Singleton bekommt statt den `state`-Cache zu teilen).
async function freshJsonStore(seedStoreContent) {
  const dir = tempDataDir(seedStoreContent);
  config.server.dataDir = dir;
  const mod = await import(`../src/store/json.js?spend-month=${jsonSeq++}`);
  return { mod, dir };
}

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (Muster reopen() aus
// test/budget-nan-fail-closed.test.js) - re-hydriert den Spiegel aus der DB statt nur
// In-Memory zu pruefen.
async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

// ---- (a)+(b): Schreiber (bookCents ueber trackUsage) + Leseprojektion (spendMonthUsageCents) ----

test("(a) trackUsage: Monatswechsel verwirft den alten Monats-Zaehler, costCents bleibt additive Lebenszeit-Summe", () => {
  const s = makeDefaultState();
  s.usage[TENANT_A] = { ...emptyUsage(), costCents: 1000, spendMonthKey: "2026-06", spendMonthCostCents: 500 };
  trackUsage(s, TENANT_A, TOKENS_60_CENT, PRICES, JULY_ISO);
  const usage = usageFor(s, TENANT_A);
  assert.equal(usage.costCents, 1000 + CENT_TRANSFER, "Lebenszeit-Zaehler bleibt additiv (1000+60)");
  assert.equal(usage.spendMonthCostCents, CENT_TRANSFER, "neuer Monat startet frisch - der alte Wert (500) zaehlt NICHT mit");
  assert.equal(usage.spendMonthKey, "2026-07");
});

test("(b) spendMonthUsageCents: aelterer gespeicherter Monat liest 0, aktueller Monat liest den vollen Wert", () => {
  const bucket = { ...emptyUsage(), spendMonthKey: "2026-06", spendMonthCostCents: 500 };
  assert.equal(spendMonthUsageCents(bucket, JULY_ISO), 0, "gespeicherter Monat ist aelter als nowIso -> 0 (Bucket bleibt unangetastet)");
  assert.equal(spendMonthUsageCents(bucket, JUNE_ISO), 500, "gleicher Monat -> voller Wert");
});

// ---- (c) MONOTONIE-Riegel: der Schluessel wandert nie rueckwaerts ----

test("(c) MONOTONIE: ein Schreibvorgang mit AELTEREM Anker stempelt den Schluessel nicht zurueck", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 700, JULY_ISO);
  let usage = usageFor(s, TENANT_A);
  assert.equal(usage.spendMonthKey, "2026-07");
  assert.equal(usage.spendMonthCostCents, 700);
  assert.equal(
    spendMonthUsageCents(usage, JUNE_ISO),
    700,
    "Leseprojektion mit einem AELTEREN nowIso liest weiterhin den vollen (autoritativen) Wert",
  );
  addVoiceUsageCostCents(s, TENANT_A, 50, JUNE_ISO);
  usage = usageFor(s, TENANT_A);
  assert.equal(usage.spendMonthCostCents, 750, "akkumuliert weiter auf dem autoritativen (spaeteren) Schluessel");
  assert.equal(usage.spendMonthKey, "2026-07", "kein Rueckwaerts-Stempel auf Juni");
});

// ---- (d) ZUKUNFT-Riegel: Clock-Skew darf NIE als frischer Monat gelesen werden ----

test("(d) ZUKUNFT: ein Schluessel in der Zukunft liest NICHT als frischer Monat und wird nicht zurueckgestempelt", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 300, SEPT_ISO); // stempelt spendMonthKey='2026-09' (Clock-Skew-Simulation)
  assert.equal(
    spendMonthUsageCents(usageFor(s, TENANT_A), JULY_ISO),
    300,
    "liest den Zukunfts-Wert, NICHT 0 - eine falsch gestellte Uhr darf den Cap nicht umgehen",
  );
  addVoiceUsageCostCents(s, TENANT_A, 20, JULY_ISO);
  const usage = usageFor(s, TENANT_A);
  assert.equal(usage.spendMonthKey, "2026-09", "kein Rueckwaerts-Stempel auf Juli");
  assert.equal(usage.spendMonthCostCents, 320, "akkumuliert weiter auf dem Zukunfts-Schluessel");
});

// ---- (e1)+(e2) MIKRO-CENT-Regel ueber die Monatsgrenze ----

test("(e1) kein Cent geht ueber die Monatsgrenze verloren (200 Sub-Cent-Turns, Monatswechsel mittendrin)", () => {
  const s = makeDefaultState();
  const TURNS_PER_MONTH = 100;
  for (let i = 0; i < TURNS_PER_MONTH; i++) trackUsage(s, TENANT_A, TOKENS_SUBCENT, PRICES, JUNE_ISO);
  for (let i = 0; i < TURNS_PER_MONTH; i++) trackUsage(s, TENANT_A, TOKENS_SUBCENT, PRICES, JULY_ISO);
  const usage = usageFor(s, TENANT_A);
  const expectedTotalMicro = MICRO_PER_SUBCENT_TURN * TURNS_PER_MONTH * 2;
  const actualTotalMicro = usage.costCents * MICRO_CENTS_PER_CENT + usage.costMicroCentsRem;
  assert.equal(actualTotalMicro, expectedTotalMicro, "Summe in Mikro-Cents ist EXAKT - kein verlorener Cent am Monatswechsel");
});

test("(e2) costMicroCentsRem ueberlebt den Monatswechsel unveraendert (kein Reset beim Uebertritt)", () => {
  const s = makeDefaultState();
  trackUsage(s, TENANT_A, TOKENS_SUBCENT, PRICES, JUNE_ISO);
  const remBefore = usageFor(s, TENANT_A).costMicroCentsRem;
  assert.equal(remBefore, MICRO_PER_SUBCENT_TURN);

  trackUsage(s, TENANT_A, TOKENS_SUBCENT, PRICES, JULY_ISO); // Monatswechsel + zweiter Turn
  const remAfter = usageFor(s, TENANT_A).costMicroCentsRem;
  assert.equal(
    remAfter,
    (remBefore + MICRO_PER_SUBCENT_TURN) % MICRO_CENTS_PER_CENT,
    "reine Modulo-Arithmetik - kein Sonderfall/Reset beim Monatswechsel",
  );
  assert.notEqual(remAfter, 0, "beweist: der Monatswechsel setzt den Sub-Cent-Rest NICHT auf 0 zurueck");
});

// ---- (f) Default-Shape ----

test("(f) emptyUsage() traegt die neuen Felder mit dem inerten Default (null/0)", () => {
  const bucket = emptyUsage();
  assert.equal(bucket.spendMonthKey, null);
  assert.equal(bucket.spendMonthCostCents, 0);
});

// ---- (g)+(h) json-Persistenz-Rundlauf ----

test("(g) json-Rundlauf: spendMonthKey/spendMonthCostCents ueberleben Reload, costMicroCentsRem bleibt ephemer", async () => {
  const { mod, dir } = await freshJsonStore();
  mod.load();
  mod.trackUsage(BOOTSTRAP_TENANT_ID, TOKENS_60_CENT, PRICES);
  const before = mod.usageOf(BOOTSTRAP_TENANT_ID);
  assert.match(before.spendMonthKey, /^\d{4}-\d{2}$/, "erste Buchung stempelt den laufenden Kalendermonat");
  assert.equal(before.spendMonthCostCents, CENT_TRANSFER);

  const raw = JSON.parse(fs.readFileSync(path.join(dir, "store.json"), "utf8"));
  const rawBucket = raw.usage[BOOTSTRAP_TENANT_ID];
  assert.equal("costMicroCentsRem" in rawBucket, false, "Sub-Cent-Rest bleibt ephemer, wie vor P4");
  assert.equal(rawBucket.spendMonthCostCents, CENT_TRANSFER, "die neue Achse WIRD persistiert (bewusste Asymmetrie, s. schema.sql)");

  config.server.dataDir = dir;
  const reopened = await import(`../src/store/json.js?spend-month-reload=${jsonSeq++}`);
  const reloaded = reopened.load().usage[BOOTSTRAP_TENANT_ID];
  assert.equal(reloaded.spendMonthKey, before.spendMonthKey);
  assert.equal(reloaded.spendMonthCostCents, CENT_TRANSFER);
});

test("(h) json-Bestandszeile ohne die neuen Felder hydriert null/0 (keine eigene Migration noetig)", async () => {
  const legacyBucket = { inputTokens: 5, outputTokens: 2, costEur: 0.01, calls: 1 };
  const { mod } = await freshJsonStore({ usage: { [BOOTSTRAP_TENANT_ID]: legacyBucket } });
  const state = mod.load();
  assert.equal(state.usage[BOOTSTRAP_TENANT_ID].spendMonthKey, null);
  assert.equal(state.usage[BOOTSTRAP_TENANT_ID].spendMonthCostCents, 0);
});

// ---- (i)+(j) pg-Persistenz-Rundlauf (PGlite) ----

test("(i) pg-Rundlauf (PGlite): trackUsage -> save -> reopen -> Schluessel+Cents hydriert", async () => {
  const { store, db } = await makePgTestStore();
  store.trackUsage(BOOTSTRAP_TENANT_ID, TOKENS_60_CENT, PRICES);
  await store.save();
  const reopened = await reopen(db);
  const usage = reopened.usageOf(BOOTSTRAP_TENANT_ID);
  assert.match(usage.spendMonthKey, /^\d{4}-\d{2}$/);
  assert.equal(usage.costCents, CENT_TRANSFER);
  assert.equal(usage.spendMonthCostCents, CENT_TRANSFER, "erste Buchung im frischen Monat: Zaehler == Lebenszeit-Betrag");
});

test("(j) pg-Bestandszeile (Seed-Insert nur tenant_id, s. db/migrate.js seedDefaults) hydriert null/0", async () => {
  const { store } = await makePgTestStore();
  const usage = store.usageOf(BOOTSTRAP_TENANT_ID);
  assert.equal(usage.spendMonthKey, null);
  assert.equal(usage.spendMonthCostCents, 0);
});

// ---- (k) Verhaltens-Identitaet: alle Gate-Praedikate sind gegen die neue Achse blind ----

test("(k) INERTHEIT: alle fuenf Gate-Praedikate sind gegen die Spend-Monat-Achse blind", () => {
  const cfg = PRICES;
  function buildState(costCents, monthAxis) {
    const s = makeDefaultState();
    s.usage[TENANT_A] = { ...emptyUsage(), costCents, ...monthAxis };
    return s;
  }
  const NEUTRAL_AXIS = {};
  // spendMonthCostCents WEIT ueber jedem realistischen Cap (999999 >> platformSpendCapCents
  // 800): wenn irgendein Gate diese Achse laese, muesste sich das Ergebnis gegenueber
  // NEUTRAL_AXIS aendern.
  const LOUD_AXIS = { spendMonthKey: "2026-01", spendMonthCostCents: 999_999 };
  for (const costCents of [500, 900]) {
    // 500 < Cap (800), 900 > Cap - Inertheit gilt in BEIDEN Faellen
    const neutral = buildState(costCents, NEUTRAL_AXIS);
    const loud = buildState(costCents, LOUD_AXIS);
    assert.equal(
      budgetExceeded(neutral, TENANT_A, cfg),
      budgetExceeded(loud, TENANT_A, cfg),
      `budgetExceeded muss bei costCents=${costCents} unabhaengig von der Monats-Achse sein`,
    );
    assert.equal(
      reserveExceedsBudget(neutral, TENANT_A, 10, cfg),
      reserveExceedsBudget(loud, TENANT_A, 10, cfg),
      `reserveExceedsBudget bei costCents=${costCents}`,
    );
    assert.equal(
      tryReserveOutboundBudget(neutral, TENANT_A, 10, cfg),
      tryReserveOutboundBudget(loud, TENANT_A, 10, cfg),
      `tryReserveOutboundBudget bei costCents=${costCents}`,
    );
  }
});

// ---- (l) Bestandssuite ohne nowIso bleibt bit-identisch ----

test("(l) ops-Ebene OHNE nowIso: die BESTANDS-Felder bleiben bit-identisch, der Schluessel bleibt ungestempelt", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 100); // kein nowIso, wie alle Bestands-Call-Sites
  trackUsage(s, TENANT_A, TOKENS_60_CENT, PRICES); // kein nowIso
  const usage = usageFor(s, TENANT_A);
  assert.equal(usage.costCents, 100 + CENT_TRANSFER, "100 (Voice) + 60 (Cent-Uebertrag) - Preisformel bit-identisch zum Bestand");
  assert.equal(usage.costMicroCentsRem, REMAINDER_AFTER_TRANSFER, "Sub-Cent-Rest bit-identisch zum Bestand");
  assert.equal(usage.inputTokens, 650_000);
  assert.equal(usage.spendMonthKey, null, "ohne Anker wird NIE gestempelt (fail-closed: kein frischer Monat ohne Uhr)");
  assert.equal(
    usage.spendMonthCostCents,
    0,
    "Review-Blocker Runde 1 (G3/T5): OHNE Anker bleibt auch der Monats-Zaehler bei 0 - " +
      "kein Phantom-Betrag ueber die null===null-Gleichheit in bookCents",
  );
});

// ---- (m) unlesbarer Anker: fail-closed = Bestand erhalten, nicht auf 0/null zuruecksetzen ----

test("(m) unlesbarer Anker: Schluessel bleibt erhalten, Zaehler akkumuliert, kein Reset auf 0", () => {
  const s = makeDefaultState();
  s.usage[TENANT_A] = { ...emptyUsage(), spendMonthKey: "2026-07", spendMonthCostCents: 400 };
  addVoiceUsageCostCents(s, TENANT_A, 50, "kaputt");
  const usage = usageFor(s, TENANT_A);
  assert.equal(usage.spendMonthKey, "2026-07", "ein unlesbarer Anker darf den Schluessel nicht loeschen");
  assert.equal(usage.spendMonthCostCents, 450, "Zaehler akkumuliert trotz unlesbarem Anker weiter");
});

// ---- (n) UTC-Ableitung: Offset-ISO gegen die naive slice(0,7)-Falle ----

test("(n) UTC-Ableitung schlaegt naive lokale Ableitung: ein Offset-ISO faellt in den korrekten UTC-Monat", () => {
  const s = makeDefaultState();
  // '+02:00'-Offset: lokal 01.08. 01:00, UTC 31.07. 23:00 - der PRAEFIX-String ("2026-08")
  // waere falsch; nur getUTC* liefert den richtigen Monat ('2026-07').
  addVoiceUsageCostCents(s, TENANT_A, 10, "2026-08-01T01:00:00+02:00");
  assert.equal(usageFor(s, TENANT_A).spendMonthKey, "2026-07");
});

// ---- (o) Migrations-Idempotenz (PGlite, kein Netz) ----

test("(o) Migrations-Idempotenz: zweiter applySchema()-Lauf wirft nicht, Spaltenzahl+Bestand unveraendert", async () => {
  const { store, db } = await makePgTestStore();
  store.trackUsage(BOOTSTRAP_TENANT_ID, TOKENS_60_CENT, PRICES);
  await store.save();

  const CUSTOM_VALUE = 4242;
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  await db.query(`UPDATE usage SET spend_month_cost_cents = $1 WHERE tenant_id = $2`, [
    CUSTOM_VALUE,
    BOOTSTRAP_TENANT_ID,
  ]);

  const columnCount = async () =>
    (
      await db.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'usage'`,
      )
    ).rows[0].n;
  const before = await columnCount();

  await applySchema(db); // zweiter Lauf - darf nicht werfen

  const after = await columnCount();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  const row = (
    await db.query(`SELECT spend_month_cost_cents FROM usage WHERE tenant_id = $1`, [BOOTSTRAP_TENANT_ID])
  ).rows[0];

  assert.equal(after, before, "Spaltenanzahl bleibt nach dem zweiten Schema-Lauf unveraendert");
  assert.equal(Number(row.spend_month_cost_cents), CUSTOM_VALUE, "DEFAULT 0 ueberschreibt den Bestand nicht");
});
