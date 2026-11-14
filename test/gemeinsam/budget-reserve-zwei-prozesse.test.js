import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { makePostgresBudgetReserve } from "../../src/store.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import {
  anrufAnBis,
  mitHermesAufPostgres,
  mitZweiHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
  rufeAnMit,
  zeilenBis,
} from "../anrufe/hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const WARTEGRENZE_MS = 5_000;
const WARTEGRENZE_PUFFER_MS = 3_000;
const ENDE_FRIST_MS = 25_000;
const DECKE_CENT = "100";
const TARIF_CENT = "30";
const NACHLAUF_MS = 2_500;
const NACHLAUF_AUFGERUNDET_S = 3;
const MAX_DAUER_S = 10;
const MANDANT = "owner";
const FREMDER_MANDANT = "tenant_fremd";
const SPERRE_NAMENSRAUM = 2666;
const SUMME_SQL = "SELECT coalesce(sum(cents), 0)::int AS summe FROM budget_reservierung";
const ZEILEN_SQL = "SELECT call_id, tenant_id, cents::int AS cents FROM budget_reservierung ORDER BY call_id";
const RESERVE_ENV = Object.freeze({
  DEFAULT_TENANT_BUDGET_CENTS: DECKE_CENT,
  VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENT,
  VOICE_TARIFF_DEFAULT_CENTS: TARIF_CENT,
  RESERVE_RELEASE_GRACE_MS: String(NACHLAUF_MS),
});
const beendet = (anruf) => anruf.status !== "active";
const einAnruf = async (sql) =>
  (await zeilenBis(async () => (await sql("SELECT id FROM call")).rows, (zeilen) => zeilen.length === 1))[0];
const summe = async (sql) => (await sql(SUMME_SQL)).rows[0].summe;

test(
  "Zwei Prozesse, Decke 100 ct, je 60 ct gleichzeitig: genau einer wird angenommen, der andere mit dem Grund der Decke abgelehnt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const { ziel } = neueAnrufe();
    await mitZweiHermesAufPostgres(t, { env: RESERVE_ENV }, async ({ a, b, anbieter, sql }) => {
      const antworten = await Promise.all([a, b].map((prozess) => rufeAnMit(prozess, { to: ziel() })));
      assert.deepEqual(antworten.map((antwort) => antwort.status).sort(), [HTTP_OK, HTTP_PAYMENT_REQUIRED]);
      const abgelehnt = antworten.find((antwort) => antwort.status === HTTP_PAYMENT_REQUIRED);
      assert.match((await abgelehnt.json()).error, /0\.20 EUR/);
      assert.equal(anbieter.starts().length, 1, "ElevenLabs sieht genau einen Start");
      assert.equal(await summe(sql), 60);
      const anruf = await einAnruf(sql);
      const { rows } = await sql(ZEILEN_SQL);
      assert.deepEqual(rows, [{ call_id: anruf.id, tenant_id: MANDANT, cents: 60 }]);
    });
  },
);

test(
  "Zwei Prozesse: die Freigabe nach dem Anrufende in Prozess A macht die 60 ct in Prozess B sofort reservierbar, die Ablauffrist ist Max-Dauer plus Nachlauf",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const { ziel } = neueAnrufe();
    await mitZweiHermesAufPostgres(t, { env: RESERVE_ENV }, async ({ a, b, sql }) => {
      const erster = ziel();
      assert.equal((await rufeAnMit(a, { to: erster, max_duration_s: MAX_DAUER_S })).status, HTTP_OK);
      const { rows } = await sql(
        "SELECT EXTRACT(EPOCH FROM ablauf_um - angelegt_um)::int AS frist_s FROM budget_reservierung",
      );
      assert.deepEqual(rows, [{ frist_s: MAX_DAUER_S + NACHLAUF_AUFGERUNDET_S }]);
      assert.equal((await rufeAnMit(b, { to: ziel() })).status, HTTP_PAYMENT_REQUIRED);
      await anrufAnBis(sql, { ziel: erster, genug: beendet, fristMs: ENDE_FRIST_MS });
      await zeilenBis(async () => summe(sql), (wert) => wert === 0);
      assert.equal((await rufeAnMit(b, { to: ziel() })).status, HTTP_OK);
      assert.equal(await summe(sql), 60);
    });
  },
);

test(
  "Zwei Prozesse, Decke 120 ct: der dritte Anruf wird mit dem Grund der erschoepften Decke und dem fehlenden Betrag abgelehnt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const { ziel } = neueAnrufe();
    const env = { ...RESERVE_ENV, DEFAULT_TENANT_BUDGET_CENTS: "120" };
    await mitZweiHermesAufPostgres(t, { env }, async ({ a, b, sql }) => {
      assert.equal((await rufeAnMit(a, { to: ziel() })).status, HTTP_OK);
      assert.equal((await rufeAnMit(b, { to: ziel() })).status, HTTP_OK);
      const dritter = await rufeAnMit(a, { to: ziel() });
      assert.equal(dritter.status, HTTP_PAYMENT_REQUIRED);
      const text = (await dritter.json()).error;
      assert.match(text, /erschoepft|exhausted|épuisé/);
      assert.match(text, /0\.60 EUR/);
      assert.equal(await summe(sql), 120);
    });
  },
);

test(
  "Zwei Prozesse: ein doppelter Auftrag an dasselbe Ziel gibt nur die eigene Reserve frei, die des laufenden Anrufs bleibt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const { ziel } = neueAnrufe();
    const env = { ...RESERVE_ENV, DEFAULT_TENANT_BUDGET_CENTS: "200" };
    await mitZweiHermesAufPostgres(t, { env }, async ({ a, sql }) => {
      const to = ziel();
      assert.equal((await rufeAnMit(a, { to })).status, HTTP_OK);
      const anruf = await einAnruf(sql);
      const doppelt = await rufeAnMit(a, { to });
      assert.equal(doppelt.status, HTTP_OK);
      assert.equal((await doppelt.json()).deduplicated, true);
      assert.deepEqual((await sql(ZEILEN_SQL)).rows, [{ call_id: anruf.id, tenant_id: MANDANT, cents: 60 }]);
    });
  },
);

test(
  "SG-32 Datenbank der Reservierungen antwortet nicht binnen 5 Sekunden: ausgehender Anruf wird abgelehnt und nichts gewählt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const { ziel } = neueAnrufe();
    await mitHermesAufPostgres(t, { env: RESERVE_ENV }, async ({ srv, anbieter, sql }) => {
      await sql("BEGIN");
      await sql("LOCK TABLE budget_reservierung IN ACCESS EXCLUSIVE MODE");
      const beginn = Date.now();
      let blockiert;
      try {
        blockiert = await abrufMitFrist(
          `${srv.localUrl}/api/calls`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: ziel(), objective: "Auftrag" }),
          },
          { wartezeitMs: WARTEGRENZE_MS + WARTEGRENZE_PUFFER_MS },
        );
      } finally {
        await sql("COMMIT");
      }
      const dauerMs = Date.now() - beginn;
      assert.equal(blockiert.status, HTTP_PAYMENT_REQUIRED);
      assert.match((await blockiert.json()).error, /lesbar|unreadable|illisible/);
      assert.match(srv.stdout, /\[budget-reservierung\] Datenbank nicht erreichbar, abgelehnt:/);
      assert.ok(dauerMs >= WARTEGRENZE_MS - 500, `wartet bis zur Grenze: ${dauerMs} ms`);
      assert.ok(dauerMs < WARTEGRENZE_MS + WARTEGRENZE_PUFFER_MS, `wartet nicht laenger: ${dauerMs} ms`);
      assert.equal(anbieter.starts().length, 0, "ElevenLabs wurde nie angerufen");
      assert.equal((await sql("SELECT count(*)::int AS n FROM call")).rows[0].n, 0);
      assert.equal(await summe(sql), 0);
      assert.equal((await rufeAnMit(srv, { to: ziel() })).status, HTTP_OK);
    });
  },
);

test(
  "Reservierungen sind je Mandant getrennt: ein Mandant sieht und loescht keine Zeile des anderen, die Sperre gilt je Mandant",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    await mitHermesAufPostgres(t, { env: RESERVE_ENV }, async ({ db, sql }) => {
      const reserveVerbindung = new pg.Client({ connectionString: db.adresse });
      await reserveVerbindung.connect();
      const reserve = makePostgresBudgetReserve({ withClient: (arbeit) => arbeit(reserveVerbindung) });
      const anfrage = (tenantId, callId) => ({
        callId,
        tenantId,
        cents: 60,
        capCents: 100,
        ablaufS: 60,
        cfg: { budgetMonthEnabled: false },
      });
      assert.equal((await reserve.reservieren(anfrage(MANDANT, "call_eigen"))).reserviert, true);
      assert.equal((await reserve.reservieren(anfrage(FREMDER_MANDANT, "call_fremd"))).reserviert, true);
      const verbindung = new pg.Client({ connectionString: db.adresse });
      await verbindung.connect();
      try {
        await verbindung.query("BEGIN");
        await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT]);
        const sichtbar = await verbindung.query("SELECT call_id FROM budget_reservierung");
        assert.deepEqual(sichtbar.rows, [{ call_id: "call_eigen" }]);
        await verbindung.query("DELETE FROM budget_reservierung");
        await verbindung.query("COMMIT");
        await verbindung.query("BEGIN");
        await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT]);
        await assert.rejects(
          verbindung.query(
            "INSERT INTO budget_reservierung (call_id, tenant_id, cents, ablauf_um) VALUES ('call_untergeschoben', $1, 1, now())",
            [FREMDER_MANDANT],
          ),
          /budget_reservierung/,
        );
        await verbindung.query("ROLLBACK");
      } finally {
        await verbindung.end();
      }
      assert.deepEqual((await sql(ZEILEN_SQL)).rows, [{ call_id: "call_fremd", tenant_id: FREMDER_MANDANT, cents: 60 }]);
      await sql("SELECT pg_advisory_lock($1, hashtext($2))", [SPERRE_NAMENSRAUM, MANDANT]);
      const beginn = Date.now();
      const anderer = await reserve.reservieren(anfrage("tenant_dritter", "call_dritter"));
      assert.equal(anderer.reserviert, true);
      assert.ok(Date.now() - beginn < WARTEGRENZE_MS, "die Sperre eines Mandanten haelt keinen anderen auf");
      const gesperrt = await reserve.reservieren(anfrage(MANDANT, "call_gesperrt"));
      assert.deepEqual(gesperrt, { reserviert: false, grund: "db" });
      await sql("SELECT pg_advisory_unlock($1, hashtext($2))", [SPERRE_NAMENSRAUM, MANDANT]);
      await reserveVerbindung.end();
    });
  },
);

test(
  "Die Tabelle der Reservierungen erzwingt Row-Level-Security auch fuer ihren Eigentuemer",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    await mitHermesAufPostgres(t, { env: RESERVE_ENV }, async ({ sql }) => {
      const { rows } = await sql(
        "SELECT relrowsecurity AS an, relforcerowsecurity AS erzwungen FROM pg_class WHERE relname = 'budget_reservierung'",
      );
      assert.deepEqual(rows, [{ an: true, erzwungen: true }]);
    });
  },
);
