import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";

const HTTP_OK = 200;
const ALARM_POSTFACH = "postfach@kv2.invalid";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: ALARM_POSTFACH, eingang: true });
const { makeDueOutboundCall } = await import("../cost-truing-harness.js");
const store = await import("../../src/store.js");

function zaehlzeile(zeilen) {
  return zeilen.find((z) => z.startsWith("[cost-truing] sweep trigger="));
}

async function sweepMitLog(hermes, sitzung) {
  const zeilen = [];
  const logOrig = console.log;
  console.log = (...a) => {
    zeilen.push(a.map(String).join(" "));
  };
  try {
    const antwort = await hermes.anfrage("/api/billing/cost-truing/sweep", { method: "POST", headers: { cookie: sitzung } });
    assert.equal(antwort.status, HTTP_OK);
    await antwort.json();
  } finally {
    console.log = logOrig;
  }
  return zaehlzeile(zeilen);
}

test("(4781) Zaehlzeile nennt fehlgeschlagen=1 bei Schreibfehler und fehlgeschlagen=0 ohne", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie: sitzung } = await hermes.anmelden();
  await hermes.db.query("UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)", ["kv2-betreiber"]);
  const state = store.load();
  const nowMs = Date.now();
  const erster = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  store.save();
  await store.drainFlushes();

  const ohne = await sweepMitLog(hermes, sitzung);
  assert.ok(ohne?.includes(" fehlgeschlagen=0 "), String(ohne));

  const state2 = store.load();
  const zweiter = makeDueOutboundCall(state2, { nowMs, estimatedCostCents: 20 });
  store.save();
  await store.drainFlushes();
  await hermes.db.query("CREATE FUNCTION schreibfehler_4781() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'db weg 4781'; END $$ LANGUAGE plpgsql");
  await hermes.db.query(`CREATE TRIGGER schreibfehler_4781 BEFORE UPDATE ON call FOR EACH ROW WHEN (OLD.id = '${zweiter.id}') EXECUTE FUNCTION schreibfehler_4781()`);
  const warnOrig = console.warn;
  console.warn = () => {};
  let mit;
  try {
    mit = await sweepMitLog(hermes, sitzung);
  } finally {
    console.warn = warnOrig;
  }
  assert.ok(mit?.includes(" fehlgeschlagen=1 "), String(mit));
  assert.ok(erster.id);
});
