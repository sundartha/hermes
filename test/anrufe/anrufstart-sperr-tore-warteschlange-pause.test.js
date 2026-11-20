import assert from "node:assert/strict";
import { test } from "node:test";

import { mitHermesAufPostgres, neueAnrufe, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const EL_PLAETZE = 4;
const WAHL_PFAD = "/v2/calls";
const PLATZ_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + interval '1 hour')`;
const EINEN_PLATZ_FREI_SQL = "DELETE FROM leitungsplatz WHERE call_id = 'voll_0'";
const PAUSE_BEI_PLATZVERGABE_SQL = `
  CREATE FUNCTION pause_bei_platzvergabe() RETURNS trigger AS $$
  BEGIN
    INSERT INTO platform_anrufpause (id, an) VALUES (1, true) ON CONFLICT (id) DO UPDATE SET an = true;
    RETURN NULL;
  END $$ LANGUAGE plpgsql;
  CREATE TRIGGER pause_bei_platzvergabe AFTER INSERT ON leitungsplatz
  FOR EACH ROW WHEN (NEW.call_id NOT LIKE 'voll_%' AND NEW.anbieter = 'elevenlabs') EXECUTE FUNCTION pause_bei_platzvergabe()`;
const ANRUF_SQL = "SELECT status, failure_reason, call_control_id FROM call";
const PLATZ_ANZAHL_SQL = "SELECT count(*)::int AS anzahl FROM leitungsplatz WHERE call_id = $1";
const RESERVE_SQL = "SELECT count(*)::int AS anzahl FROM budget_reservierung WHERE call_id = $1";
const KOSTEN_SQL = "SELECT coalesce(sum(cost_eur), 0)::float8 AS eur FROM usage";
const BUDGET_UMGEBUNG = { MAX_BUDGET_EUR: "10", VOICE_TARIFF_DOMESTIC_CENTS: "20", ALLOWED_COUNTRY_CODES: "*" };

test("K5b-3a: wird die Anrufpause genau zwischen Platzvergabe und Wahl aktiv, endet der wartende Anruf mit not-placed:anrufpause ohne Wahl", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const attrappe = await starteAttrappe(async () => {});
  t.after(() => attrappe.close());
  const vorspann = vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: "sperrtore" });
  const starts = () => attrappe.pfade.filter((pfad) => pfad === WAHL_PFAD);
  await mitHermesAufPostgres(t, { env: { ...vorspann, ...BUDGET_UMGEBUNG } }, async ({ srv, sql }) => {
    for (let index = 0; index < EL_PLAETZE; index += 1) await sql(PLATZ_SQL, [`voll_${index}`, `t_voll_${index}`]);
    await sql(PAUSE_BEI_PLATZVERGABE_SQL);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    assert.equal(starts().length, 0);

    await sql(EINEN_PLATZ_FREI_SQL);
    const [ende] = await zeilenBis(
      async () => (await sql(ANRUF_SQL)).rows,
      (zeilen) => zeilen[0]?.status === "failed",
    );
    assert.equal(ende.failure_reason, "not-placed:anrufpause");
    assert.equal(ende.call_control_id, null);
    assert.equal(starts().length, 0);
    await zeilenBis(
      async () => (await sql(PLATZ_ANZAHL_SQL, [callId])).rows[0].anzahl,
      (anzahl) => anzahl === 0,
    );
    await zeilenBis(
      async () => (await sql(RESERVE_SQL, [callId])).rows[0].anzahl,
      (anzahl) => anzahl === 0,
    );
    assert.equal((await sql(KOSTEN_SQL)).rows[0].eur, 0);
  });
});
