import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const JUNI = "2026-06";
const DIVISOR = 1_000_000 * 1_000_000;
const ZEILE_SQL = "SELECT * FROM usage WHERE tenant_id = $1";

function beobachteterSpeicher(runner) {
  const beobachtung = { abbruchBeimCommit: false, schreibzugriffe: 0 };
  const beobachtet = {
    withClient: (fn) =>
      runner.withClient((client) =>
        fn({
          ...client,
          query: (text, params) => {
            if (beobachtung.abbruchBeimCommit && text === "COMMIT") throw new Error("Abbruch beim Commit");
            if (/FOR UPDATE|UPDATE usage SET/.test(text)) beobachtung.schreibzugriffe += 1;
            return client.query(text, params);
          },
        }),
      ),
  };
  return { speicher: makePgStore(beobachtet), beobachtung };
}

async function zeile(runner) {
  const { rows } = await runner.withClient((client) => client.query(ZEILE_SQL, [TENANT]));
  return Object.fromEntries(
    Object.entries(rows[0]).map(([name, wert]) => [name, typeof wert === "string" && /^[\d.]+$/.test(wert) ? Number(wert) : wert]),
  );
}

const nutzung = (speicher) => speicher.load().usage[TENANT];

test("Speichern ohne eigene Aenderung sperrt und schreibt die Nutzungszeile nicht, mit Aenderung schon", async () => {
  const { runner } = await makePgTestStore();
  const { speicher, beobachtung } = beobachteterSpeicher(runner);
  await speicher.init();
  await speicher.save();
  assert.equal(beobachtung.schreibzugriffe, 0);
  nutzung(speicher).calls += 1;
  await speicher.save();
  assert.equal(beobachtung.schreibzugriffe, 2);
  assert.equal((await zeile(runner)).calls, 1);
});

test("ein Speichern nach einem Abbruch beim Commit merkt sich die verworfene Buchung nicht als gespeichert", async () => {
  const { runner } = await makePgTestStore();
  const { speicher, beobachtung } = beobachteterSpeicher(runner);
  await speicher.init();
  const usage = nutzung(speicher);
  usage.costCents += 40;
  usage.spendMonthKey = JUNI;
  usage.spendMonthCostCents = 40;
  beobachtung.abbruchBeimCommit = true;
  await speicher.save();
  beobachtung.abbruchBeimCommit = false;
  assert.equal((await zeile(runner)).cost_eur, 0);
  Object.assign(usage, { costCents: 0, spendMonthKey: null, spendMonthCostCents: 0 });
  await speicher.save();
  usage.costCents += 10;
  await speicher.save();
  assert.equal((await zeile(runner)).cost_eur, 0.1);
});

test("eine Gutschrift ueber den Stand hinaus laesst die Kosten bei 0 und speichert die anderen Zaehler trotzdem", async () => {
  const { runner } = await makePgTestStore();
  const { speicher } = beobachteterSpeicher(runner);
  await speicher.init();
  nutzung(speicher).costCents += 10;
  await speicher.save();
  const zweiter = makePgStore(runner);
  await zweiter.init();
  nutzung(speicher).costCents -= 10;
  await speicher.save();
  nutzung(zweiter).costCents -= 10;
  nutzung(zweiter).calls += 1;
  await zweiter.save();
  const db = await zeile(runner);
  assert.deepEqual([db.cost_eur, db.calls], [0, 1]);
});

test("ein Kostenstand von genau 0 mit Rest in der Datenbank nimmt den Uebertrag vom Monatsstand ab", async () => {
  const { runner } = await makePgTestStore();
  const { speicher } = beobachteterSpeicher(runner);
  await speicher.init();
  await runner.withClient((client) =>
    client.query(
      "UPDATE usage SET cost_eur = 0.01, cost_correction_micro_cents_rem = $2, spend_month_key = $3, spend_month_cost_cents = 100 WHERE tenant_id = $1",
      [TENANT, -DIVISOR, JUNI],
    ),
  );
  const usage = nutzung(speicher);
  usage.calls += 1;
  usage.spendMonthKey = JUNI;
  await speicher.save();
  const db = await zeile(runner);
  assert.deepEqual([db.cost_eur, db.cost_correction_micro_cents_rem, db.spend_month_cost_cents], [0, 0, 99]);
});
