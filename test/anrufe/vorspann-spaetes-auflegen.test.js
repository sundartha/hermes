import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const AUDIO = Buffer.alloc(200_000, 0xab);
const CALLEE_BEIN = "cc_callee_spaet";
const EL_BEIN = "cc_el_spaet";
const ZIEL = "+4915112399006";
const ZUSTAND_FEHLT = "rueckfall grund=zustand_fehlt";
const EL_BEIN_SQL = "SELECT el_call_control_id FROM call WHERE id = $1";
const ABRECHNUNG_SQL = "SELECT billed_at FROM call WHERE id = $1";
const SCHLUESSEL_SPERRE_SQL = "LOCK TABLE anruf_schluessel IN ACCESS EXCLUSIVE MODE";
const NUTZUNG_SQL = "SELECT * FROM usage";

const beinFuer = (roh) => (roh.includes('-el"') ? EL_BEIN : CALLEE_BEIN);

function starteAnbieter() {
  const aufrufe = { wiedergaben: [], auflegen: [] };
  const anfrageVon = (anfrage) =>
    new Promise((fertig) => {
      const teile = [];
      anfrage.on("data", (stueck) => teile.push(stueck));
      anfrage.on("end", () => fertig(Buffer.concat(teile).toString()));
    });
  const server = starteAttrappe(async (anfrage, antwort) => {
    const roh = await anfrageVon(anfrage);
    if (anfrage.url.startsWith("/v1/text-to-speech/")) {
      antwort.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      return antwort.end(AUDIO);
    }
    if (anfrage.url.endsWith("/actions/playback_start")) aufrufe.wiedergaben.push(JSON.parse(roh));
    if (anfrage.url.endsWith("/actions/hangup")) aufrufe.auflegen.push(anfrage.url);
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ data: { sid: "v3:spaet", result: "ok", call_control_id: beinFuer(roh) } }));
  });
  return server.then((attrappe) => ({ attrappe, aufrufe }));
}

function ereignis(signer, srv, { callId, art: eventType, kennung }) {
  const rumpf = JSON.stringify({
    data: { id: `evt-${eventType}-${callId}-${kennung}`, event_type: eventType, payload: { call_control_id: CALLEE_BEIN, status: "ok" } },
  });
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf), "telnyx-timestamp": zeitstempel },
    body: rumpf,
  });
}

const zaehleMarke = (instanzen, marke) => instanzen.reduce((summe, srv) => summe + srv.stdout.split(marke).length - 1, 0);

async function mitAnbieter(t, lauf) {
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
  };
  await mitZweiHermesAufPostgres(t, { env }, (instanzen) => lauf({ ...instanzen, signer, aufrufe }));
}

async function platziereUndHebeAb({ a, b, sql, signer, aufrufe }) {
  const start = await abrufMitFrist(`${a.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
  });
  assert.equal(start.status, HTTP_OK);
  const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL]);
  assert.equal(rows.length, 1);
  const callId = rows[0].id;
  assert.equal((await ereignis(signer, b, { callId, art: "call.answered", kennung: "ab" })).status, HTTP_OK);
  await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length === 1);
  await zeilenBis(async () => (await sql(EL_BEIN_SQL, [callId])).rows, (zeilen) => zeilen[0]?.el_call_control_id === EL_BEIN);
  return { callId };
}

const elAuflegen = (aufrufe) => aufrufe.auflegen.filter((url) => url.includes(EL_BEIN));

test("Ein spätes zweites Auflegen auf der anderen Instanz löst weder Rückfall noch zweites Auflegen noch zweite Buchung aus", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async (srv) => {
    const { callId } = await platziereUndHebeAb(srv);
    assert.equal((await ereignis(srv.signer, srv.a, { callId, art: "call.hangup", kennung: "a" })).status, HTTP_OK);
    await zeilenBis(async () => (await srv.sql(ABRECHNUNG_SQL, [callId])).rows, (zeilen) => zeilen[0].billed_at !== null);
    await zeilenBis(async () => elAuflegen(srv.aufrufe), (liste) => liste.length === 1);
    const nutzungVorher = (await srv.sql(NUTZUNG_SQL)).rows;
    const marke = `[vorspann] verarbeitet ${JSON.stringify({ callId, ereignis: "aufgelegt" })}`;
    assert.equal(zaehleMarke([srv.b], marke), 0);
    assert.equal((await ereignis(srv.signer, srv.b, { callId, art: "call.hangup", kennung: "b" })).status, HTTP_OK);
    await zeilenBis(async () => zaehleMarke([srv.b], marke), (anzahl) => anzahl === 1);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
    assert.equal(elAuflegen(srv.aufrufe).length, 1);
    assert.deepEqual((await srv.sql(NUTZUNG_SQL)).rows, nutzungVorher);
  });
});


test("Ein spätes zweites Auflegen auf einer Instanz, die den Anrufstatus nicht lesen kann, protokolliert den Lesefehler und tut nichts", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async (srv) => {
    const { callId } = await platziereUndHebeAb(srv);
    assert.equal((await ereignis(srv.signer, srv.a, { callId, art: "call.hangup", kennung: "a" })).status, HTTP_OK);
    await zeilenBis(async () => (await srv.sql(ABRECHNUNG_SQL, [callId])).rows, (zeilen) => zeilen[0].billed_at !== null);
    await zeilenBis(async () => elAuflegen(srv.aufrufe), (liste) => liste.length === 1);
    const nutzungVorher = (await srv.sql(NUTZUNG_SQL)).rows;
    const marke = `[vorspann] verarbeitet ${JSON.stringify({ callId, ereignis: "aufgelegt" })}`;
    await srv.sql("BEGIN");
    try {
      await srv.sql(SCHLUESSEL_SPERRE_SQL);
      assert.equal((await ereignis(srv.signer, srv.b, { callId, art: "call.hangup", kennung: "b" })).status, HTTP_OK);
      await zeilenBis(async () => zaehleMarke([srv.b], marke), (anzahl) => anzahl === 1);
    } finally {
      await srv.sql("ROLLBACK");
    }
    assert.equal(zaehleMarke([srv.b], `lesen fehlgeschlagen call=${callId}`), 1);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
    assert.equal(elAuflegen(srv.aufrufe).length, 1);
    assert.deepEqual((await srv.sql(NUTZUNG_SQL)).rows, nutzungVorher);
  });
});

