import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const JUNI = "2026-06";
const DIVISOR = 1_000_000 * 1_000_000;
const ZEILE_SQL = "SELECT * FROM usage WHERE tenant_id = $1";

function beobachteterSpeicher(runner) {
  const beobachtung = { abbruchBeimCommit: false };
  const beobachtet = {
    withClient: (fn) =>
      runner.withClient((client) =>
        fn({
          ...client,
          query: (text, params) => {
            if (beobachtung.abbruchBeimCommit && text === "COMMIT") throw new Error("Abbruch beim Commit");
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

const SCHREIBZAEHLER_DDL = `
  CREATE TABLE usage_schreibzugriffe (n serial);
  CREATE FUNCTION usage_schreibzugriff_zaehlen() RETURNS trigger AS $$
    BEGIN INSERT INTO usage_schreibzugriffe DEFAULT VALUES; RETURN NEW; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER usage_schreibzugriff BEFORE UPDATE ON usage
    FOR EACH ROW EXECUTE FUNCTION usage_schreibzugriff_zaehlen();`;

async function schreibzugriffe(runner) {
  const { rows } = await runner.withClient((client) => client.query("SELECT count(*) AS n FROM usage_schreibzugriffe"));
  return Number(rows[0].n);
}

test("Speichern ohne eigene Aenderung laesst die Buchung eines zweiten Speichers unberuehrt, mit Aenderung kommt beides zusammen", async () => {
  const { runner } = await makePgTestStore();
  const { speicher } = beobachteterSpeicher(runner);
  await speicher.init();
  const zweiter = makePgStore(runner);
  await zweiter.init();
  await runner.withClient((client) => client.exec(SCHREIBZAEHLER_DDL));
  nutzung(zweiter).calls += 1;
  await zweiter.save();
  const nachZweitem = await schreibzugriffe(runner);
  assert.equal(nachZweitem, 1);
  await speicher.save();
  assert.equal(await schreibzugriffe(runner), nachZweitem);
  assert.equal((await zeile(runner)).calls, 1);
  nutzung(speicher).calls += 1;
  await speicher.save();
  assert.equal(await schreibzugriffe(runner), nachZweitem + 1);
  assert.equal((await zeile(runner)).calls, 2);
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
