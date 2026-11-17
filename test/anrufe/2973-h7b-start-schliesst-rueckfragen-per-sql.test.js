import assert from "node:assert/strict";
import { test } from "node:test";

import { BEANTWORTETER_ANRUF, BEENDETER_ANRUF, FREMDER_ANRUF, LESEN_VOR_DEN_RUECKFRAGEN, MANDANT, startMitDatenbank } from "./2973-h7b-start-helfer.js";

test("H7b-13: eine offene Rueckfrage eines Anrufs, den nur die Datenbank kennt, wird beim Start geschlossen", async () => {
  const { db, fehler, meldungen } = await startMitDatenbank(Infinity, LESEN_VOR_DEN_RUECKFRAGEN + 1);
  assert.equal(fehler, undefined);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT]);
  assert.ok(meldungen.includes("[boot] verwaiste Rueckfragen geschlossen: 1 Anrufe, 0 mit freigegebenem Kontingent"), meldungen.join("\n"));
  const frageStatus = async (id) => {
    const { rows } = await db.query(`SELECT consults FROM call WHERE id = $1`, [id]);
    const [frage] = rows[0].consults;
    return frage.status;
  };
  assert.equal(await frageStatus(FREMDER_ANRUF), "expired");
  assert.equal(await frageStatus(BEENDETER_ANRUF), "open");
  assert.equal(await frageStatus(BEANTWORTETER_ANRUF), "answered");
});
