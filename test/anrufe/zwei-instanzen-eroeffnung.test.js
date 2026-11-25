import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { initAuf, platziereAuf } from "./zwei-instanzen-kernwege-hilfen.js";
import { HTTP_OK, ereignis, mitAnbieter } from "./vorspann-zwei-instanzen-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const EINMAL = 1;
const GRUSS = "Hallo,";
const KI_HINWEIS = "ich bin Hermes, der KI-Assistent von Jonas Beispiel";
const ANSCHLUSS = "Es geht um Folgendes: Termin am Donnerstag vereinbaren. Bitte sprechen Sie.";
const TEXT_SQL = "SELECT text FROM vorspann_zustand WHERE call_id = $1";

const vorkommen = (text, teil) => text.split(teil).length - EINMAL;

async function eroeffnungEinmal(t, { vorspannAuf, initAuf: initInstanz }) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitAnbieter(t, async (srv) => {
    const { sql, signer, aufrufe } = srv;
    const vorspann = srv[vorspannAuf];
    const callId = await platziereAuf(vorspann, sql, "de");
    assert.equal((await ereignis(signer, vorspann, { callId, art: "call.answered" })).status, HTTP_OK);
    await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length === EINMAL);
    const { rows } = await sql(TEXT_SQL, [callId]);
    const gesprochen = rows[0].text;
    assert.ok(gesprochen.startsWith(GRUSS), gesprochen);
    assert.equal(vorkommen(gesprochen, KI_HINWEIS), EINMAL);
    const anderer = await initAuf(srv[initInstanz], sql, callId);
    assert.equal(anderer.conversation_config_override.agent.first_message, ANSCHLUSS);
    assert.equal(anderer.dynamic_variables.eroeffnung_gesagt, gesprochen);
    const wieder = await initAuf(vorspann, sql, callId);
    assert.equal(wieder.conversation_config_override.agent.first_message, ANSCHLUSS);
    assert.equal(aufrufe.wiedergaben.length, EINMAL);
  });
}

test("T7 Vorspann A, Init B: der Init auf B traegt leere first_message und den auf A gesprochenen KI-Hinweis genau einmal", { timeout: ZEITGRENZE_MS }, (t) =>
  eroeffnungEinmal(t, { vorspannAuf: "a", initAuf: "b" }));

test("T7 Vorspann B, Init A: der Init auf A traegt leere first_message und den auf B gesprochenen KI-Hinweis genau einmal", { timeout: ZEITGRENZE_MS }, (t) =>
  eroeffnungEinmal(t, { vorspannAuf: "b", initAuf: "a" }));
