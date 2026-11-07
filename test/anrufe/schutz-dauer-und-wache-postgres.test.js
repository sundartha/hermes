import assert from "node:assert/strict";
import test from "node:test";

import { waitUntil } from "../helpers.js";
import {
  anrufAnBis,
  mitHermesAufPostgres,
  mitHermesAufPostgresGeseedet,
  mitHermesAufPostgresHartNeustartbar,
  neueAnrufe,
  postgresVorhanden,
  rufeAnMit,
  seedeLaufendenAnruf,
  seedeVerbrauch,
  zeilenBis,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const ENDE_FRIST_MS = 6_000;
const NEUSTART_ENDE_FRIST_MS = 15_000;
const AUFLEGEN_FRIST_MS = 3_000;
const KURZ_S = 2;
const LANG_S = 30;
const NEUSTART_DAUER_S = 8;

const KOSTENDECKE_CENT = 1000;
const RESTBUDGET_UNTER_DEN_LAUFENDEN_KOSTEN_CENT = 210;
const RESTBUDGET_UEBER_DEN_LAUFENDEN_KOSTEN_CENT = 230;
const TARIF_CENT = "20";
const LAUFENDER_ANRUF_MS = (9 * 60 + 5) * 1000;
const LAUFENDER_ANRUF_MAX_S = 1800;
const VERBRAUCH_SQL = "SELECT cost_eur * 100 AS cent FROM usage";

const WACHE_ENV = Object.freeze({
  DEFAULT_TENANT_BUDGET_CENTS: String(KOSTENDECKE_CENT),
  VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENT,
  VOICE_TARIFF_DEFAULT_CENTS: TARIF_CENT,
  BUDGET_WATCHDOG_INTERVAL_MS: "200",
});

const beendet = (anruf) => anruf.status !== "active";
const gestartet = (anruf) => Boolean(anruf.konversation);

function laufenderAnrufBeiVerbrauch(ziel, verbraucht) {
  return async (sql) => {
    await seedeLaufendenAnruf(sql, {
      ziel,
      laeuftSeitMs: LAUFENDER_ANRUF_MS,
      maxDurationS: LAUFENDER_ANRUF_MAX_S,
    });
    await seedeVerbrauch(sql, verbraucht);
  };
}

async function aufgelegt(anbieter, anruf) {
  await waitUntil(() => anbieter.beendetGespraech(anruf.konversation), {
    timeoutMs: AUFLEGEN_FRIST_MS,
  });
}

async function startet(srv, auftrag) {
  assert.equal((await rufeAnMit(srv, auftrag)).status, HTTP_OK);
}

async function endeMitBudget({ srv, anbieter, sql }, ziel) {
  await startet(srv, { to: ziel });
  const anruf = await anrufAnBis(sql, { ziel, genug: beendet, fristMs: ENDE_FRIST_MS });
  assert.equal(anruf.failure_reason, "budget-exhausted");
  await aufgelegt(anbieter, anruf);
}

test("PG-MAXDAUER: ein EL-Anruf endet per SQL nach seiner Max-Dauer, ein zugleich gestarteter laengerer laeuft weiter", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitHermesAufPostgres(t, {}, async ({ srv, anbieter, sql }) => {
    const [lang, kurz] = [ziel(), ziel()];
    await startet(srv, { to: lang, max_duration_s: LANG_S });
    await startet(srv, { to: kurz, max_duration_s: KURZ_S });
    const anruf = await anrufAnBis(sql, { ziel: kurz, genug: beendet, fristMs: ENDE_FRIST_MS });
    assert.equal(anruf.status, "completed");
    assert.equal(anruf.failure_reason, "max-duration-cap");
    await aufgelegt(anbieter, anruf);
    const langer = await anrufAnBis(sql, { ziel: lang, genug: gestartet });
    assert.equal(langer.status, "active");
    assert.equal(anbieter.beendetGespraech(langer.konversation), false);
    assert.deepEqual(srv.readStore().calls, []);
  });
});

test("PG-MAXDAUER-NEUSTART: nach hartem Neustart beendet der zweite Lauf den laufenden Anruf mit seiner Max-Dauer", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitHermesAufPostgresHartNeustartbar(t, {}, async ({ srv, anbieter, sql, neustartHart }) => {
    const to = ziel();
    await startet(srv, { to, max_duration_s: NEUSTART_DAUER_S });
    const laufend = await anrufAnBis(sql, { ziel: to, genug: gestartet });
    assert.equal(laufend.status, "active");
    const zweiter = await neustartHart();
    const anruf = await anrufAnBis(sql, {
      ziel: to,
      genug: beendet,
      fristMs: NEUSTART_ENDE_FRIST_MS,
    });
    assert.equal(anruf.failure_reason, "max-duration-cap");
    await aufgelegt(zweiter.anbieter, anruf);
    assert.equal(anbieter.beendetGespraech(anruf.konversation), false);
    assert.deepEqual(zweiter.srv.readStore().calls, []);
  });
});

test("PG-GELD-WACHE: reisst ein laufender Anruf die Kostendecke, beendet die Geld-Wache einen neuen EL-Anruf mit budget-exhausted", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  const seed = laufenderAnrufBeiVerbrauch(
    ziel(),
    KOSTENDECKE_CENT - RESTBUDGET_UNTER_DEN_LAUFENDEN_KOSTEN_CENT,
  );
  await mitHermesAufPostgresGeseedet(t, { env: WACHE_ENV, seed }, async (lauf) => {
    await endeMitBudget(lauf, ziel());
    assert.deepEqual(lauf.srv.readStore().calls, []);
  });
});

test("PG-GELD-WACHE Kontrolle: unter der Kostendecke endet der EL-Anruf an seiner Max-Dauer, nicht an der Geld-Wache", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  const seed = laufenderAnrufBeiVerbrauch(
    ziel(),
    KOSTENDECKE_CENT - RESTBUDGET_UEBER_DEN_LAUFENDEN_KOSTEN_CENT,
  );
  await mitHermesAufPostgresGeseedet(t, { env: WACHE_ENV, seed }, async ({ srv, sql }) => {
    const to = ziel();
    await startet(srv, { to, max_duration_s: KURZ_S });
    const anruf = await anrufAnBis(sql, { ziel: to, genug: beendet, fristMs: ENDE_FRIST_MS });
    assert.equal(anruf.failure_reason, "max-duration-cap");
    assert.deepEqual(srv.readStore().calls, []);
  });
});

test("PG-GELD-WACHE-NEUSTART: reisst der Verbrauch die Decke, waehrend Hermes steht, beendet der zweite Lauf den laufenden Anruf mit budget-exhausted", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  const seed = async () => {};
  await mitHermesAufPostgresGeseedet(
    t,
    { env: WACHE_ENV, seed },
    async ({ srv, sql, neustartHartNach }) => {
      const to = ziel();
      await startet(srv, { to });
      assert.equal((await anrufAnBis(sql, { ziel: to, genug: gestartet })).status, "active");
      const zweiter = await neustartHartNach((verwaltung) =>
        seedeVerbrauch(verwaltung, KOSTENDECKE_CENT),
      );
      const anruf = await anrufAnBis(sql, { ziel: to, genug: beendet, fristMs: ENDE_FRIST_MS });
      assert.equal(anruf.failure_reason, "budget-exhausted");
      await aufgelegt(zweiter.anbieter, anruf);
      assert.deepEqual(zweiter.srv.readStore().calls, []);
    },
  );
});

test("PG-KOSTENDECKE-NEUSTART: nach einem Ende mit budget-exhausted und hartem Neustart lehnt Hermes den naechsten Anruf mit 402 ab", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  const seed = laufenderAnrufBeiVerbrauch(
    ziel(),
    KOSTENDECKE_CENT - RESTBUDGET_UNTER_DEN_LAUFENDEN_KOSTEN_CENT,
  );
  await mitHermesAufPostgresGeseedet(t, { env: WACHE_ENV, seed }, async (lauf) => {
    await endeMitBudget(lauf, ziel());
    await zeilenBis(
      async () => (await lauf.sql(VERBRAUCH_SQL)).rows,
      ([verbrauch]) => Number(verbrauch?.cent) >= KOSTENDECKE_CENT,
    );
    const zweiter = await lauf.neustartHartNach(async () => {});
    assert.equal((await rufeAnMit(zweiter.srv, { to: ziel() })).status, HTTP_PAYMENT_REQUIRED);
    assert.equal(zweiter.anbieter.starts().length, 0);
    assert.deepEqual(zweiter.srv.readStore().calls, []);
  });
});
