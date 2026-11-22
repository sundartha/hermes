import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_SERVERFEHLER = 500;
const AUDIO = Buffer.alloc(200_000, 0xab);
const CALLEE_BEIN = "cc_callee_andere";
const EL_BEIN = "cc_el_andere";
const ZIEL = "+4915112399003";
const ZUSTAND_FEHLT = "rueckfall grund=zustand_fehlt";
const STATUS_SQL = "SELECT status, failure_reason FROM call WHERE id = $1";

const beinFuer = (roh) => (roh.includes('-el"') ? EL_BEIN : CALLEE_BEIN);

function starteAnbieter(verhalten) {
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
    if (anfrage.url.endsWith("/actions/hangup") && verhalten.auflegenScheitert) {
      antwort.writeHead(HTTP_SERVERFEHLER, { "content-type": "application/json" });
      return antwort.end("{}");
    }
    if (anfrage.url === "/v2/calls") await verhalten.beiWahl?.();
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ data: { sid: "v3:andere", result: "ok", call_control_id: beinFuer(roh) } }));
  });
  return server.then((attrappe) => ({ attrappe, aufrufe }));
}

function ereignis(signer, srv, { callId, art: eventType, kennung = "" }) {
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

const platziere = (srv, ziel = ZIEL) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ziel, objective: "Termin am Donnerstag vereinbaren" }),
  });

async function mitAnbieter(t, verhalten, lauf) {
  const signer = makeTelnyxSigner();
  const { attrappe, aufrufe } = await starteAnbieter(verhalten);
  t.after(() => attrappe.close());
  const env = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    ELEVENLABS_API_BASE: attrappe.url,
    TELNYX_API_BASE: attrappe.url,
    ...verhalten.umgebung,
  };
  await mitZweiHermesAufPostgres(t, { env }, (instanzen) => lauf({ ...instanzen, signer, aufrufe }));
}

const callIdVon = async (sql) => {
  const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL]);
  assert.equal(rows.length, 1);
  return rows[0].id;
};

const zaehleMarke = (instanzen, marke) => instanzen.reduce((summe, srv) => summe + srv.stdout.split(marke).length - 1, 0);
const LADEN_FEHLT = "[el-vorspann] ereignis fehlgeschlagen call=";

test("Fehlt die Zeile in der Datenbank, endet der Anruf auf Instanz B mit zustand_fehlt und das Bein ist aufgelegt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, {}, async ({ a, b, sql, signer, aufrufe }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    await sql("DELETE FROM vorspann_zustand WHERE call_id = $1", [callId]);
    assert.equal((await ereignis(signer, b, { callId, art: "call.answered" })).status, HTTP_OK);
    await zeilenBis(async () => (await sql(STATUS_SQL, [callId])).rows, (zeilen) => zeilen[0].status === "failed");
    assert.deepEqual((await sql(STATUS_SQL, [callId])).rows, [{ status: "failed", failure_reason: "zustand_fehlt" }]);
    assert.equal(zaehleMarke([a, b], `${ZUSTAND_FEHLT} call=${callId}`), 1);
    await zeilenBis(async () => aufrufe.auflegen, (liste) => liste.some((url) => url.includes(CALLEE_BEIN)));
    assert.deepEqual(aufrufe.wiedergaben, []);
  });
});

test("Ist die Zeile nicht lesbar, bleibt der Anruf aktiv, nichts wird aufgelegt und nichts als fehlender Zustand behandelt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, {}, async ({ a, b, sql, signer, aufrufe }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    await sql("ALTER TABLE vorspann_zustand RENAME COLUMN stand TO stand_unlesbar");
    assert.equal((await ereignis(signer, b, { callId, art: "call.answered" })).status, HTTP_OK);
    await zeilenBis(async () => b.stdout, (text) => text.includes(`${LADEN_FEHLT}${callId}`));
    assert.deepEqual((await sql(STATUS_SQL, [callId])).rows, [{ status: "active", failure_reason: null }]);
    assert.equal(zaehleMarke([a, b], ZUSTAND_FEHLT), 0);
    assert.deepEqual(aufrufe.auflegen, []);
    assert.deepEqual(aufrufe.wiedergaben, []);
  });
});
