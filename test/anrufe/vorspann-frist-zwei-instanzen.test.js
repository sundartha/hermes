import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { CALLEE_BEIN, EL_BEIN, HTTP_OK, ZIEL, ZUSTAND_FEHLT, EL_BEIN_SQL, starteAnbieter, zaehleMarke } from "./vorspann-zwei-instanzen-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const KURZ_MS = "1500";
const LANG_MS = "600000";
const TAKT_MS = "200";
const STATUS_SQL = "SELECT status, failure_reason FROM call WHERE id = $1";

const sende = (signer, srv, { callId, art, status = "completed" }) => {
  const rumpf = JSON.stringify({ data: { id: `evt-4b-${art}-${callId}`, event_type: art, payload: { call_control_id: CALLEE_BEIN, status } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeit, rumpf), "telnyx-timestamp": zeit },
    body: rumpf,
  });
};

async function beendeInstanz(srv) {
  const beendet = new Promise((fertig) => srv.child.once("exit", fertig));
  srv.child.kill("SIGTERM");
  await beendet;
}

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
    FRISTEN_TAKT_MS: TAKT_MS,
    ...fristen,
  };
  await mitZweiHermesAufPostgres(t, { env }, (instanzen) => lauf({ ...instanzen, signer, aufrufe }));
}

async function hebeAufAAb({ a, sql, signer, aufrufe }) {
  const start = await abrufMitFrist(`${a.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
  });
  assert.equal(start.status, HTTP_OK);
  const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL]);
  const callId = rows[0].id;
  assert.equal((await sende(signer, a, { callId, art: "call.answered" })).status, HTTP_OK);
  await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length === 1);
  await zeilenBis(async () => (await sql(EL_BEIN_SQL, [callId])).rows, (zeilen) => zeilen[0]?.el_call_control_id === EL_BEIN);
  return callId;
}

const beideBeineAufgelegt = (aufrufe) => aufrufe.auflegen.some((url) => url.includes(CALLEE_BEIN)) && aufrufe.auflegen.some((url) => url.includes(EL_BEIN));

test("5928-4b K7: kommt nach dem Abheben auf A kein Wiedergabe-Ende und ist A beendet, legt B beide Beine auf und vermerkt vorspann_nicht_abgespielt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitFristen(t, { VORSPANN_WIEDERGABE_FRIST_MS: KURZ_MS, EL_BRIDGE_START_DEADLINE_MS: LANG_MS }, async (srv) => {
    const callId = await hebeAufAAb(srv);
    await beendeInstanz(srv.a);
    await zeilenBis(async () => srv.aufrufe, beideBeineAufgelegt);
    const [anruf] = await zeilenBis(
      async () => (await srv.sql(STATUS_SQL, [callId])).rows,
      (zeilen) => zeilen[0]?.failure_reason === "vorspann_nicht_abgespielt",
    );
    assert.equal(anruf.failure_reason, "vorspann_nicht_abgespielt");
    assert.equal(srv.aufrufe.auflegen.length, 2);
    assert.equal(zaehleMarke([srv.b], "rueckfall grund=vorspann_nicht_abgespielt"), 1);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
  });
});

test("5928-4b K7: kommt nach dem Wiedergabe-Ende auf B kein EL-Bein und ist A beendet, legt B beide Beine auf und vermerkt el_frist", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitFristen(t, { VORSPANN_WIEDERGABE_FRIST_MS: LANG_MS, EL_BRIDGE_START_DEADLINE_MS: KURZ_MS }, async (srv) => {
    const callId = await hebeAufAAb(srv);
    assert.equal((await sende(srv.signer, srv.b, { callId, art: "call.playback.ended" })).status, HTTP_OK);
    await beendeInstanz(srv.a);
    await zeilenBis(async () => srv.aufrufe, beideBeineAufgelegt);
    const [anruf] = await zeilenBis(async () => (await srv.sql(STATUS_SQL, [callId])).rows, (zeilen) => zeilen[0]?.failure_reason === "el_frist");
    assert.equal(anruf.failure_reason, "el_frist");
    assert.equal(zaehleMarke([srv.b], "rueckfall grund=el_frist"), 1);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
  });
});
