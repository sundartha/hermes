import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "./echtes-postgres.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { postgresVorhanden, seedeMandant, starteAnAnbieter, starteAttrappeMitGespraechsende, zeilenBis } from "../anrufe/hermes-mit-postgres.js";

const NEGATIV_WARTEN_MS = 5_000;
const MANDANT = { id: "tenant_pruef", sub: "sub-pruef", e164: "+4930555000399" };
const ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_pruef",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_pruef",
  ELEVENLABS_API_KEY: "el-pruef-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "200",
  DEFAULT_TENANT_BUDGET_CENTS: "80",
  VOICE_TARIFF_DOMESTIC_CENTS: "30",
  VOICE_TARIFF_DEFAULT_CENTS: "30",
});
const KONVERSATION_SQL =
  "SELECT elevenlabs_conversation_id AS id FROM call WHERE elevenlabs_conversation_id IS NOT NULL ORDER BY seq LIMIT 1";
const RESERVEN_SQL = "SELECT call_id, cents::int AS cents FROM budget_reservierung ORDER BY angelegt_um";
const SCHREIBER_WARTET_SQL = "SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%usage%'";
const VERBRAUCH_SQL = "SELECT round(cost_eur * 100)::int AS cent FROM usage WHERE tenant_id = $1";

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

let zaehler = 0;
const rufeAn = (prozess) => {
  zaehler += 1;
  const ziel = `+49151123401${String(zaehler).padStart(3, "0")}`;
  return abrufMitFrist(
    `${prozess.localUrl}/api/calls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Identity": MANDANT.sub },
      body: JSON.stringify({ to: ziel, objective: `Auftrag ${ziel}` }),
    },
    { wartezeitMs: 60_000 },
  );
};

test("Reserve von Anruf A bleibt, bis seine Kosten in usage stehen; Anruf B ueber der Decke wird abgelehnt", { timeout: 240_000 }, async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sperre = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await sperre.connect();
  const anbieter = await starteAttrappeMitGespraechsende();
  const sql = (text, p) => verwaltung.query(text, p);
  const gestartet = [];
  const starte = async () => {
    const i = await starteAnAnbieter(db, anbieter, { ...ENV, ELEVENLABS_INBOUND_TENANT_IDS: MANDANT.id });
    gestartet.push(i);
    return i;
  };
  try {
    await (await starte()).stop();
    await seedeMandant(sql, MANDANT);
    const a = await starte();
    const b = await starte();

    const erste = await rufeAn(a);
    assert.equal(erste.status, 200, await erste.text());
    const id = (await zeilenBis(async () => (await sql(KONVERSATION_SQL)).rows, (z) => z.length === 1))[0].id;

    await sperre.query("BEGIN");
    await sperre.query("LOCK TABLE usage IN EXCLUSIVE MODE");

    anbieter.beendeGespraech(id, [{ role: "agent", message: "Auf Wiederhoeren." }]);

    await zeilenBis(async () => (await sql(SCHREIBER_WARTET_SQL)).rows, (z) => z.length > 0);
    await zeilenBis(async () => (await sql(RESERVEN_SQL)).rows, (z) => z.length === 0, NEGATIV_WARTEN_MS).catch(() => null);
    const zweite = rufeAn(b);
    await zeilenBis(async () => (await sql(RESERVEN_SQL)).rows, (z) => z.length === 1, NEGATIV_WARTEN_MS).catch(() => null);
    await sperre.query("COMMIT");
    const antwortB = await zweite;

    await zeilenBis(
      async () => (await sql(VERBRAUCH_SQL, [MANDANT.id])).rows,
      (z) => z.length === 1 && z[0].cent > 0,
    );
    assert.equal(antwortB.status, 402, "B haette abgelehnt werden muessen: Kosten von A + neue Reserve > Decke");
  } finally {
    await sperre.end().catch(() => {});
    await Promise.all(gestartet.map((i) => i.stop()));
    await anbieter.schliessen();
    await verwaltung.end();
  }
});
