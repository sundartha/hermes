import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { beendeAufAnderer, mitZweiSchreibern, ZIEL_DER_ANRUFE } from "./zwei-schreiber-hilfen.js";

const HTTP_OK = 200;
const ANRUFE_JE_ZIEL_SQL = "SELECT id, status FROM call WHERE to_e164 = $1 ORDER BY seq";

const platziereNoch = async (instanz, to) => {
  const antwort = await abrufMitFrist(`${instanz.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: `Zweiter Auftrag ${to}` }),
  });
  return { status: antwort.status, body: await antwort.json() };
};

test("ZWEI-SCHREIBER-T2: POST /api/calls auf Instanz A innerhalb von 180 Sekunden nach dem Ende auf Instanz B legt einen neuen Anruf an und meldet keine Dublette", async (t) => {
  await mitZweiSchreibern(t, async ({ a, b, platziere, sql }) => {
    const erster = await platziere(a, ZIEL_DER_ANRUFE);
    await beendeAufAnderer(b, erster);
    const zweiter = await platziereNoch(a, ZIEL_DER_ANRUFE);
    assert.equal(zweiter.status, HTTP_OK);
    assert.equal(zweiter.body.deduplicated, false);
    assert.notEqual(zweiter.body.callId, erster);
    const { rows } = await sql(ANRUFE_JE_ZIEL_SQL, [ZIEL_DER_ANRUFE]);
    assert.deepEqual(
      rows.map((zeile) => zeile.id),
      [erster, zweiter.body.callId],
    );
  });
});
