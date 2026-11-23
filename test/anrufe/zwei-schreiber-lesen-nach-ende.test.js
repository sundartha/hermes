import assert from "node:assert/strict";
import { test } from "node:test";

import {
  anrufVon,
  beendeAufAnderer,
  mitZweiSchreibern,
  ZIEL_DER_ANRUFE,
} from "./zwei-schreiber-hilfen.js";

const HTTP_OK = 200;
const IN_DATENBANK = "cancelled";
const ANGEZEIGT = "cancelled";

test("ZWEI-SCHREIBER-T3: GET /api/calls/:id auf Instanz A zeigt den Anruf als beendet, nachdem Instanz B ihn beendet hat", async (t) => {
  await mitZweiSchreibern(t, async ({ a, b, platziere, sql }) => {
    const callId = await platziere(a, ZIEL_DER_ANRUFE);
    await beendeAufAnderer(b, callId);
    const { rows } = await sql("SELECT status FROM call WHERE id = $1", [callId]);
    assert.equal(rows[0].status, IN_DATENBANK);
    const gelesen = await anrufVon(a, callId);
    assert.equal(gelesen.status, HTTP_OK);
    assert.equal(gelesen.anruf.status, ANGEZEIGT);
  });
});
