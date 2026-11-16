import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";

const HTTP_OK = 200;
const ALARM_POSTFACH = "postfach@kv2.invalid";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: ALARM_POSTFACH, eingang: true });
const { makeDueOutboundCall } = await import("../cost-truing-harness.js");
const store = await import("../../src/store.js");

test("(4709) Schreibfehler an einem Anruf bricht den Abgleichlauf nicht ab: failed=1, zweiter Anruf wird gezaehlt, Deckungsbefund kommt", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie: sitzung } = await hermes.anmelden();
  await hermes.db.query("UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)", ["kv2-betreiber"]);

  const state = store.load();
  const nowMs = Date.now();
  const erster = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  store.save();
  await store.drainFlushes();
  await hermes.db.query("CREATE FUNCTION schreibfehler_4709() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'db weg 4709'; END $$ LANGUAGE plpgsql");
  await hermes.db.query(`CREATE TRIGGER schreibfehler_4709 BEFORE UPDATE ON call FOR EACH ROW WHEN (OLD.id = '${erster.id}') EXECUTE FUNCTION schreibfehler_4709()`);

  const zeilen = [];
  const warnOrig = console.warn;
  console.warn = (...a) => zeilen.push(a.map(String).join(" "));
  let sweep;
  try {
    sweep = await hermes.anfrage("/api/billing/cost-truing/sweep", { method: "POST", headers: { cookie: sitzung } });
  } finally {
    console.warn = warnOrig;
  }
  assert.equal(sweep.status, HTTP_OK);
  const ergebnis = await sweep.json();
  assert.ok(zeilen.some((z) => z.startsWith(`[cost-truing] Schreibfehler call=${erster.id}: `) && z.includes("db weg 4709")));
  assert.equal(ergebnis.candidates, 2);
  assert.equal(ergebnis.failed, 1);
  assert.equal(ergebnis.unavailable, 1);
  const befunde = await hermes.warteAufProtokoll("cost_truing_befund", (zeile) => /^grund=coverage_below_threshold /.test(zeile.detail ?? ""));
  assert.equal(befunde.length, 1, "Abdeckungsbefund erscheint trotz Schreibfehler");
});
