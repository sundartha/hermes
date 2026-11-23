import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner } from "../helpers.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { HTTP_OK, ZIEL, ereignis, starteAnbieter } from "./vorspann-zwei-instanzen-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const KLINGEL_S = 75;
const PUFFER_S = 30;
const TOLERANZ_S = 20;
const ZEILE_SQL = "SELECT extract(epoch FROM expires_at - now()) AS rest_s FROM vorspann_zustand WHERE call_id = $1";
const ID_SQL = "SELECT id FROM call WHERE to_e164 = $1";

async function mitFristen(t, fristen, lauf) {
  const signer = makeTelnyxSigner();
  const { attrappe, aufrufe } = await starteAnbieter();
  t.after(() => attrappe.close());
  const env = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    ELEVENLABS_API_BASE: attrappe.url,
    TELNYX_API_BASE: attrappe.url,
    ...fristen,
  };
  await mitZweiHermesAufPostgres(t, { env }, (instanzen) => lauf({ ...instanzen, signer, aufrufe }));
}

async function waehle({ a, sql }) {
  const start = await abrufMitFrist(`${a.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
  });
  assert.equal(start.status, HTTP_OK);
  const { rows } = await sql(ID_SQL, [ZIEL]);
  assert.equal(rows.length, 1);
  await zeilenBis(async () => (await sql(ZEILE_SQL, [rows[0].id])).rows, (zeilen) => zeilen.length === 1);
  return rows[0].id;
}

const restS = async (sql, callId) => Number((await sql(ZEILE_SQL, [callId])).rows[0].rest_s);

function pruefeRest(rest, erwartetS) {
  assert.ok(rest > erwartetS - TOLERANZ_S, `Rest ${rest} s liegt unter ${erwartetS - TOLERANZ_S} s`);
  assert.ok(rest <= erwartetS, `Rest ${rest} s liegt ueber ${erwartetS} s`);
}

const GROSS = { VORSPANN_WIEDERGABE_FRIST_MS: "120000", EL_BRIDGE_START_DEADLINE_MS: "120000" };

test("Mit Fristen von 120 s lebt die Vorspann-Zeile nach dem Waehlen ueber Klingelfrist plus 120 s hinaus", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitFristen(t, GROSS, async (srv) => {
    const callId = await waehle(srv);
    const rest = await restS(srv.sql, callId);
    assert.ok(rest > KLINGEL_S + 120, `Rest ${rest} s endet vor Klingelfrist plus Wiedergabefrist`);
    pruefeRest(rest, KLINGEL_S + 120 + PUFFER_S);
  });
});

test("Nach call.answered liegt das Ablaufen der Zeile hinter dem spaetesten Fristende ab Abheben", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitFristen(t, GROSS, async (srv) => {
    const callId = await waehle(srv);
    assert.equal((await ereignis(srv.signer, srv.b, { callId, art: "call.answered", kennung: "ab" })).status, HTTP_OK);
    await zeilenBis(async () => srv.aufrufe.wiedergaben, (liste) => liste.length === 1);
    const rest = await restS(srv.sql, callId);
    assert.ok(rest > 120 + PUFFER_S - TOLERANZ_S, `Rest ${rest} s endet vor dem Fristende ab Abheben`);
  });
});

test("Mit Standardfristen (20 s und 30 s) lebt die Zeile Klingelfrist plus 30 s plus Puffer", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitFristen(t, {}, async (srv) => {
    const callId = await waehle(srv);
    pruefeRest(await restS(srv.sql, callId), KLINGEL_S + 30 + PUFFER_S);
  });
});
