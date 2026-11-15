import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mandantenAbruf,
  mitHermesAufPostgresMitMandanten,
  mitZweiHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const HTTP_UNAVAILABLE = 503;
const MINUTE_MS = 60_000;
const STUNDE_MS = 60 * MINUTE_MS;
const ZIEL = "+4915112349901";
const ANDERES_ZIEL = "+4915112349902";
const GATE_FEHLER = "Sicherheitspruefung derzeit nicht moeglich. Der Anruf wurde nicht gestartet.";
const ANLEGEN_FEHLER =
  "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.";
const GROSSES_LIMIT = "50";

const MANDANT_A = Object.freeze({ id: "tenant_zsql_a", sub: "sub-zsql-a", e164: "+4930555000201" });
const MANDANT_B = Object.freeze({ id: "tenant_zsql_b", sub: "sub-zsql-b", e164: "+4930555000202" });

const SEED_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at)
  VALUES ($1, $2, $3, 'outbound', 'active', (SELECT e164 FROM number WHERE tenant_id = $2), $4, 'Altauftrag', $5)`;

const ROLLE_DER_ANWENDUNG_SQL = `SELECT DISTINCT usename FROM pg_stat_activity
  WHERE datname = current_database() AND usename <> current_user`;

let nummer = 0;
const vorMs = (ms) => new Date(Date.now() - ms).toISOString();

async function seedeAnruf(sql, { mandant, ziel, vorMillisekunden }) {
  nummer += 1;
  await sql(SEED_SQL, [
    `call_zsql_${nummer}`,
    mandant.id,
    `tok_zsql_${nummer}`,
    ziel,
    vorMs(vorMillisekunden),
  ]);
}

function mitKunden(t, env, lauf) {
  return mitHermesAufPostgresMitMandanten(t, { env, mandanten: [MANDANT_A, MANDANT_B] }, (hermes) =>
    lauf({ ...hermes, a: mandantenAbruf(hermes.srv, MANDANT_A.sub) }),
  );
}

async function abgelehnt(res, grund) {
  assert.equal(res.status, HTTP_TOO_MANY);
  assert.equal((await res.json()).reason, grund);
}

test("ZAEHLUNG-1: ein Kunde mit Stundenlimit 1 und einem Anruf vor 10 Minuten bekommt 429 stundenlimit, die Attrappe waehlt nicht", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitKunden(t, { MAX_CALLS_PER_HOUR: "1" }, async ({ a, sql, anbieter }) => {
    await seedeAnruf(sql, { mandant: MANDANT_A, ziel: ZIEL, vorMillisekunden: 10 * MINUTE_MS });
    await abgelehnt(await a.rufeAn(ANDERES_ZIEL), "stundenlimit");
    assert.equal(anbieter.starts().length, 0);
  });
});

test("ZAEHLUNG-1G: ein Anruf von vor zwei Stunden zaehlt nicht zum Stundenlimit", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitKunden(t, { MAX_CALLS_PER_HOUR: "1" }, async ({ a, sql, anbieter }) => {
    await seedeAnruf(sql, { mandant: MANDANT_A, ziel: ZIEL, vorMillisekunden: 2 * STUNDE_MS });
    assert.equal((await a.rufeAn(ANDERES_ZIEL)).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1);
  });
});

test("ZAEHLUNG-2: drei Anrufe an dasselbe Ziel in 24 Stunden, der letzte aelter als 180 s, ergeben 429 ziel_limit", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const env = { MAX_CALLS_PER_HOUR: GROSSES_LIMIT, PER_TARGET_CALL_CAP: "3" };
  await mitKunden(t, env, async ({ a, sql, anbieter }) => {
    for (const minuten of [4, 20, 50])
      await seedeAnruf(sql, { mandant: MANDANT_A, ziel: ZIEL, vorMillisekunden: minuten * MINUTE_MS });
    await abgelehnt(await a.rufeAn(ZIEL), "ziel_limit");
    assert.equal(anbieter.starts().length, 0);
    assert.equal((await a.rufeAn(ANDERES_ZIEL)).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1);
  });
});

test("ZAEHLUNG-3: Anrufe eines anderen Mandanten zaehlen weder zum Stunden- noch zum Ziel-Limit", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const env = { MAX_CALLS_PER_HOUR: "1", PER_TARGET_CALL_CAP: "1" };
  await mitKunden(t, env, async ({ a, sql, anbieter }) => {
    await seedeAnruf(sql, { mandant: MANDANT_B, ziel: ZIEL, vorMillisekunden: 10 * MINUTE_MS });
    assert.equal((await a.rufeAn(ZIEL)).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1);
  });
});

test("ZAEHLUNG-4: ist die Zaehlung nicht lesbar, wird nicht gewaehlt (fail-closed, kein Lesefehler als frei)", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitKunden(t, { MAX_CALLS_PER_HOUR: GROSSES_LIMIT }, async ({ a, sql, anbieter }) => {
    const { rows } = await sql(ROLLE_DER_ANWENDUNG_SQL);
    await sql(`REVOKE SELECT ON call FROM ${rows[0].usename}`);
    const res = await a.rufeAn(ZIEL);
    assert.equal(res.status, HTTP_UNAVAILABLE);
    assert.equal((await res.json()).error, GATE_FEHLER);
    assert.equal(anbieter.starts().length, 0);
  });
});

test("ZAEHLUNG-4A: ist der Anruf nicht in die Datenbank schreibbar, wird nicht gewaehlt und der Fehler lautet wie beim Anlegen", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitKunden(t, { MAX_CALLS_PER_HOUR: GROSSES_LIMIT }, async ({ a, sql, anbieter }) => {
    const { rows } = await sql(ROLLE_DER_ANWENDUNG_SQL);
    await sql(`REVOKE INSERT ON call FROM ${rows[0].usename}`);
    const res = await a.rufeAn(ZIEL);
    assert.equal(res.status, HTTP_UNAVAILABLE);
    assert.equal((await res.json()).error, ANLEGEN_FEHLER);
    assert.equal(anbieter.starts().length, 0);
  });
});

test("ZAEHLUNG-5: ein Anruf, den Instanz A anlegt, zaehlt sofort auf Instanz B", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, { env: { MAX_CALLS_PER_HOUR: "1" } }, async ({ a, b, anbieter }) => {
    const { rufeAn } = neueAnrufe();
    assert.equal((await rufeAn(a)).status, HTTP_OK);
    await abgelehnt(await rufeAn(b), "stundenlimit");
    assert.equal(anbieter.starts().length, 1);
  });
});
