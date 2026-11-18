import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitHermesAufPostgres, neueAnrufe, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const EL_PLAETZE = 4;
const WAHL_PFAD = "/v2/calls";
const DEPLOY_TOKEN = "k5b3a-anrufpause-deploy-token-mindestens-32";
const PAUSE_PFAD = "/intern/anrufpause";
const PLATZ_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + interval '1 hour')`;
const PLAETZE_LEEREN_SQL = "DELETE FROM leitungsplatz";
const ANRUF_SQL = `SELECT id, status, failure_reason, call_control_id, max_duration_s,
  extract(epoch FROM (frist_hoechstdauer_at - now()))::float8 AS frist_rest_s
  FROM call`;
const PLATZ_ANZAHL_SQL = "SELECT count(*)::int AS anzahl FROM leitungsplatz WHERE call_id = $1";
const WARTEFRIST_KURZ_MS = "1500";
const WAHL_ABGELEHNT = 422;
const RESERVE_SQL = "SELECT count(*)::int AS anzahl FROM budget_reservierung WHERE call_id = $1";
const KOSTEN_SQL = "SELECT coalesce(sum(cost_eur), 0)::float8 AS eur FROM usage";
const ANRUF_REIHE_SQL = "SELECT id, call_control_id FROM call ORDER BY seq";
const EINEN_PLATZ_FREI_SQL = "DELETE FROM leitungsplatz WHERE call_id = 'voll_0'";
const BUDGET_UMGEBUNG = { MAX_BUDGET_EUR: "10", VOICE_TARIFF_DOMESTIC_CENTS: "20", ALLOWED_COUNTRY_CODES: "*" };

async function mitWartendemServer(t, { env = {}, wahlAblehnung = null }, lauf) {
  const attrappe = await starteAttrappe(async () => {}, wahlAblehnung);
  t.after(() => attrappe.close());
  const vorspann = vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: "wartend" });
  const umgebung = { ...vorspann, HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN, ...env };
  const starts = () => attrappe.pfade.filter((pfad) => pfad === WAHL_PFAD);
  return mitHermesAufPostgres(t, { env: umgebung }, (laufzeit) => lauf({ ...laufzeit, starts }));
}

async function fuelleAllePlaetze(sql) {
  for (let index = 0; index < EL_PLAETZE; index += 1) await sql(PLATZ_SQL, [`voll_${index}`, `t_voll_${index}`]);
}

const platzAnzahl = async (sql, callId) => {
  const { rows } = await sql(PLATZ_ANZAHL_SQL, [callId]);
  return rows[0].anzahl;
};
const reserveAnzahl = async (sql, callId) => (await sql(RESERVE_SQL, [callId])).rows[0].anzahl;
const platzFreiBis = (sql, callId) =>
  zeilenBis(
    async () => platzAnzahl(sql, callId),
    (anzahl) => anzahl === 0,
  );
const reserveFreiBis = (sql, callId) =>
  zeilenBis(
    async () => reserveAnzahl(sql, callId),
    (anzahl) => anzahl === 0,
  );
const kostenEur = async (sql) => (await sql(KOSTEN_SQL)).rows[0].eur;
const anrufe = async (sql) => (await sql(ANRUF_SQL)).rows;
const einzigerAnruf = async (sql) => {
  const zeilen = await anrufe(sql);
  assert.equal(zeilen.length, 1);
  return zeilen[0];
};

const pause = (srv, an) =>
  abrufMitFrist(`${srv.localUrl}${PAUSE_PFAD}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${DEPLOY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ an }),
  });

test("K5b-3a: bei belegten Leitungen antwortet place_call sofort mit dialing und waehlt nicht, wird ein Platz frei, wird genau einmal gewaehlt und die Timer zaehlen ab der Wahl", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitWartendemServer(t, {}, async ({ srv, sql, starts }) => {
    await fuelleAllePlaetze(sql);
    const anrufer = neueAnrufe();
    const ziel = anrufer.ziel();
    const antwort = await anrufer.rufeAn(srv, { to: ziel });
    assert.equal(antwort.status, HTTP_OK);
    const koerper = await antwort.json();
    assert.equal(koerper.status, "dialing");
    assert.equal(koerper.deduplicated, false);
    assert.equal(starts().length, 0);
    const doppelt = await (await anrufer.rufeAn(srv, { to: ziel, objective: "anderes Ziel" })).json();
    assert.equal(doppelt.deduplicated, true);
    assert.equal(doppelt.callId, koerper.callId);
    const wartend = await einzigerAnruf(sql);
    assert.equal(wartend.id, koerper.callId);
    assert.equal(wartend.status, "active");
    assert.equal(wartend.call_control_id, null);
    assert.equal(wartend.frist_rest_s, null);

    await sql(PLAETZE_LEEREN_SQL);
    const gewaehlt = await zeilenBis(
      async () => anrufe(sql),
      (zeilen) => zeilen[0]?.call_control_id && zeilen[0]?.frist_rest_s !== null,
    );
    assert.equal(starts().length, 1);
    assert.equal(gewaehlt[0].call_control_id, `cc_callee_${koerper.callId}`);
    assert.equal(gewaehlt[0].status, "active");
    assert.ok(
      gewaehlt[0].frist_rest_s > gewaehlt[0].max_duration_s - 3,
      `die Hoechstdauer zaehlt ab der Wahl, nicht ab dem Warten: ${gewaehlt[0].frist_rest_s} von ${gewaehlt[0].max_duration_s}`,
    );
    assert.equal(await platzAnzahl(sql, koerper.callId), 2);
  });
});

test("K5b-3a: kein Platz bis zum Ende der Frist, der Anruf endet mit klarem Grund, ohne Wahl, ohne Platz", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const env = { ANRUFSTART_WARTEFRIST_MS: WARTEFRIST_KURZ_MS, ...BUDGET_UMGEBUNG };
  await mitWartendemServer(t, { env }, async ({ srv, sql, starts }) => {
    await fuelleAllePlaetze(sql);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    assert.equal(await reserveAnzahl(sql, callId), 1);
    const ende = await zeilenBis(
      async () => anrufe(sql),
      (zeilen) => zeilen[0]?.status === "failed",
    );
    assert.equal(ende[0].failure_reason, "at-capacity:queue-timeout");
    assert.equal(starts().length, 0);
    await platzFreiBis(sql, callId);
    await reserveFreiBis(sql, callId);
    assert.equal(await kostenEur(sql), 0);
  });
});

test("K5b-3a: wird waehrend des Wartens die Anrufpause aktiv, wird nie gewaehlt und der Anruf endet, auch wenn danach ein Platz frei wird", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitWartendemServer(t, { env: BUDGET_UMGEBUNG }, async ({ srv, sql, starts }) => {
    await fuelleAllePlaetze(sql);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    assert.equal(await reserveAnzahl(sql, callId), 1);
    assert.equal((await pause(srv, true)).status, HTTP_OK);
    const ende = await zeilenBis(
      async () => anrufe(sql),
      (zeilen) => zeilen[0]?.status === "failed",
    );
    assert.equal(ende[0].failure_reason, "not-placed:anrufpause");
    await sql(PLAETZE_LEEREN_SQL);
    assert.equal(starts().length, 0);
    await platzFreiBis(sql, callId);
    await reserveFreiBis(sql, callId);
    assert.equal(await kostenEur(sql), 0);
    const nochmal = await neueAnrufe().rufeAn(srv);
    assert.equal(nochmal.status, HTTP_FORBIDDEN);
  });
});

test("K5b-3a: lehnt der Anbieter die Wahl des wartenden Anrufs ab, endet der Anruf und es gibt nie eine zweite Wahl", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitWartendemServer(t, { wahlAblehnung: WAHL_ABGELEHNT }, async ({ srv, sql, starts }) => {
    await fuelleAllePlaetze(sql);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_OK);
    await sql(PLAETZE_LEEREN_SQL);
    const [ende] = await zeilenBis(
      async () => anrufe(sql),
      (zeilen) => zeilen[0]?.status === "failed",
    );
    assert.equal(ende.failure_reason, "not-placed:start-422");
    assert.equal(starts().length, 1);
    await platzFreiBis(sql, ende.id);
  });
});

test("K5b-3a: warten zwei Anrufe des Kunden und wird ein einziger Platz frei, wird der zuerst angenommene genau einmal gewaehlt und der zweite noch nicht", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitWartendemServer(t, {}, async ({ srv, sql, starts }) => {
    await fuelleAllePlaetze(sql);
    const anrufer = neueAnrufe();
    const erster = await (await anrufer.rufeAn(srv)).json();
    const zweiter = await (await anrufer.rufeAn(srv)).json();
    assert.equal((await anrufe(sql)).length, 2);
    assert.equal(starts().length, 0);

    await sql(EINEN_PLATZ_FREI_SQL);
    await zeilenBis(
      async () => (await sql(ANRUF_REIHE_SQL)).rows,
      (zeilen) => zeilen[0]?.call_control_id,
    );
    const reihe = (await sql(ANRUF_REIHE_SQL)).rows;
    assert.equal(reihe[0].id, erster.callId);
    assert.equal(reihe[0].call_control_id, `cc_callee_${erster.callId}`);
    assert.equal(reihe[1].id, zweiter.callId);
    assert.equal(reihe[1].call_control_id, null);
    assert.equal(starts().length, 1);
  });
});
