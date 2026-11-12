import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { mitZweiHermesAufPostgres, neueAnrufe, postgresVorhanden, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { waitForLog } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const WARTEGRENZE_MS = 5_000;
const ANTWORT_FRIST_MS = 2_000;
const LOG_FRIST_MS = WARTEGRENZE_MS + 3_000;
const AUSGEHEND_BELEGT = 89;
const EINGEHEND_BELEGT = 10;
const NUMMER_SQL = "SELECT e164 FROM number WHERE tenant_id = $1";
const BELEGEN_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um, richtung)
  SELECT $1 || n, 'telnyx', 'tenant_fremd', now() + interval '1 hour', $2 FROM generate_series(1, $3) AS n`;
const EINGEHEND_SQL = "SELECT count(*)::int AS anzahl FROM leitungsplatz WHERE richtung = 'eingehend'";
const ANRUFE_SQL = "SELECT count(*)::int AS anzahl FROM call WHERE direction = 'inbound'";

let zaehler = 0;
async function nimmAn(prozess, nummer, fristMs) {
  zaehler += 1;
  const beginn = Date.now();
  const antwort = await abrufMitFrist(
    `${prozess.localUrl}/voice/incoming`,
    {
      method: "POST",
      body: new URLSearchParams({ CallSid: `CAzp${zaehler}`, From: "+4915112340000", To: nummer }),
    },
    { wartezeitMs: LOG_FRIST_MS },
  );
  return { status: antwort.status, dauerMs: Date.now() - beginn };
}

async function mitBelegterLeitung(t, lauf) {
  await mitZweiHermesAufPostgres(t, {}, async (ctx) => {
    const { rows } = await ctx.sql(NUMMER_SQL, [BOOTSTRAP_TENANT_ID]);
    await ctx.sql(BELEGEN_SQL, ["alt_aus_", "ausgehend", AUSGEHEND_BELEGT]);
    await ctx.sql(BELEGEN_SQL, ["alt_ein_", "eingehend", EINGEHEND_BELEGT]);
    return lauf({ ...ctx, nummer: rows[0].e164 });
  });
}

test(
  "Eingehend 5: ein in Prozess A angenommener eingehender Anruf zaehlt fuer den ausgehenden Start in Prozess B",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitBelegterLeitung(t, async ({ a, b, sql, nummer }) => {
      assert.equal((await nimmAn(a, nummer)).status, HTTP_OK);
      await zeilenBis(
        async () => (await sql(EINGEHEND_SQL)).rows[0].anzahl,
        (anzahl) => anzahl === EINGEHEND_BELEGT + 1,
      );
      const antwort = await neueAnrufe().rufeAn(b);
      assert.equal(antwort.status, HTTP_UNAVAILABLE);
      assert.equal((await antwort.json()).reason, "ausgelastet");
    });
  },
);

test(
  "SG-31 Eingehender Anruf bei voller Leitung: wird nie abgewiesen und zaehlt nie gegen den Kundenanteil, auch nicht wenn die Datenbank der Leitungsplaetze nicht antwortet",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitBelegterLeitung(t, async ({ a, sql, nummer }) => {
      await sql("BEGIN");
      await sql("LOCK TABLE leitungsplatz IN ACCESS EXCLUSIVE MODE");
      let antwort;
      try {
        antwort = await nimmAn(a, nummer);
        await waitForLog(a, /\[leitungsplaetze\] Eingehend nicht gezaehlt:/, LOG_FRIST_MS);
      } finally {
        await sql("COMMIT");
      }
      assert.equal(antwort.status, HTTP_OK);
      assert.ok(antwort.dauerMs < ANTWORT_FRIST_MS, `Antwort wartet nicht auf die Datenbank: ${antwort.dauerMs} ms`);
      assert.equal((await sql(ANRUFE_SQL)).rows[0].anzahl, 1);
      assert.equal((await sql(EINGEHEND_SQL)).rows[0].anzahl, EINGEHEND_BELEGT, "kein Platz belegt");
    });
  },
);
