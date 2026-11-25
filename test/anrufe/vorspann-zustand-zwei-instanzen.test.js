import assert from "node:assert/strict";
import test from "node:test";

import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.ts";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds, EL_INBOUND_ACCESS_BOOT_ENV } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_NICHT_ERREICHBAR = 503;
const TTL_S = 165;
const TTL_UNTERGRENZE_S = 135;
const AUDIO = Buffer.alloc(200_000, 0xab);
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const CALLEE_BEIN = "cc_callee_zustand";
const EL_BEIN = "cc_el_zustand";
const ZIEL = "+4915112399002";
const AGENT_ID = "agent_pg";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const ZEILE_SQL = "SELECT token, text, callee_id, stand, aufgelegt, abgehoben, extract(epoch FROM expires_at - now()) AS rest_s FROM vorspann_zustand WHERE call_id = $1";
const ANZAHL_SQL = "SELECT count(*)::int AS anzahl FROM vorspann_zustand";
const ALTE_ZEILE_SQL = `INSERT INTO vorspann_zustand (call_id, tenant_id, token, text, expires_at)
  VALUES ('call_alt', '${BOOTSTRAP_TENANT_ID}', 'alt', 'alter Satz', now() - interval '1 minute')`;
const SICHERHEIT_SQL = "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'vorspann_zustand'";

const beinFuer = (roh) => (roh.includes("-el\"") ? EL_BEIN : CALLEE_BEIN);

function starteAnbieter(verhalten) {
  const gesprochen = [];
  const wiedergaben = [];
  const anfrageVon = (anfrage) =>
    new Promise((fertig) => {
      const teile = [];
      anfrage.on("data", (stueck) => teile.push(stueck));
      anfrage.on("end", () => fertig(Buffer.concat(teile).toString()));
    });
  const server = starteAttrappe(async (anfrage, antwort) => {
    const roh = await anfrageVon(anfrage);
    if (anfrage.url.startsWith("/v1/text-to-speech/")) {
      gesprochen.push(JSON.parse(roh).text);
      antwort.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      return antwort.end(AUDIO);
    }
    if (anfrage.url.endsWith("/actions/playback_start")) wiedergaben.push(JSON.parse(roh));
    const wahl = anfrage.url === "/v2/calls" ? await verhalten.beiWahl?.(JSON.parse(roh)) : undefined;
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ data: { sid: "v3:zustand", result: "ok", call_control_id: wahl === "ohne" ? undefined : beinFuer(roh) } }));
  });
  return server.then((attrappe) => ({ attrappe, gesprochen, wiedergaben }));
}

function ereignis(signer, srv, { callId, art: eventType }) {
  const rumpf = JSON.stringify({
    data: { id: `evt-${eventType}-${callId}`, event_type: eventType, payload: { call_control_id: CALLEE_BEIN, status: "ok" } },
  });
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf), "telnyx-timestamp": zeitstempel },
    body: rumpf,
  });
}

const platziere = (srv) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
  });

async function init(srv, sql, callId) {
  const { rows } = await sql("SELECT stream_token, from_e164 FROM call WHERE id = $1", [callId]);
  const antwort = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: `conv_${callId}`,
      called_number: rows[0].from_e164,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: rows[0].stream_token },
    }),
  });
  return { status: antwort.status, json: await antwort.json() };
}

async function mitAnbieter(t, verhalten, lauf) {
  const signer = makeTelnyxSigner();
  const { attrappe, gesprochen, wiedergaben } = await starteAnbieter(verhalten);
  t.after(() => attrappe.close());
  const env = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    ELEVENLABS_API_BASE: attrappe.url,
    TELNYX_API_BASE: attrappe.url,
  };
  await mitZweiHermesAufPostgres(t, { env }, (instanzen) => lauf({ ...instanzen, signer, gesprochen, wiedergaben }));
}

const callIdVon = async (sql) => {
  const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL]);
  assert.equal(rows.length, 1);
  return rows[0].id;
};

test("Der gesprochene Vorspann eines auf Instanz A gewaehlten Anrufs steht beim Init auf Instanz B in der Eroeffnung; die Zeile geht beim Auflegen weg", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, {}, async ({ a, b, sql, signer, gesprochen, wiedergaben }) => {
    await sql(ALTE_ZEILE_SQL);
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    assert.equal((await ereignis(signer, a, { callId, art: "call.answered" })).status, HTTP_OK);
    const [{ audio_url: audioUrl }] = await zeilenBis(async () => wiedergaben, (liste) => liste.length === 1);
    const antwort = await init(b, sql, callId);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(antwort.json.dynamic_variables.eroeffnung_gesagt, gesprochen.at(-1));
    const { rows } = await sql(ZEILE_SQL, [callId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, gesprochen.at(-1));
    assert.equal(rows[0].callee_id, CALLEE_BEIN);
    assert.deepEqual([Object.keys(rows[0].stand), rows[0].aufgelegt, rows[0].abgehoben], [["ABGEHOBEN"], [], true]);
    assert.ok(rows[0].rest_s > TTL_UNTERGRENZE_S && rows[0].rest_s <= TTL_S, `Restlaufzeit ${rows[0].rest_s}`);
    assert.equal((await sql("SELECT 1 FROM vorspann_zustand WHERE call_id = 'call_alt'")).rowCount, 0);
    assert.deepEqual((await sql(SICHERHEIT_SQL)).rows, [{ relrowsecurity: true, relforcerowsecurity: true }]);
    assert.equal(rows[0].token, audioUrl.split("/voice/tts/")[1]);
    assert.match(rows[0].token, TOKEN_FORMAT);
    assert.equal((await ereignis(signer, a, { callId, art: "call.hangup" })).status, HTTP_OK);
    await zeilenBis(async () => (await sql(ANZAHL_SQL)).rows[0].anzahl, (anzahl) => anzahl === 0);
  });
});

test("Ist die Zeile abgelaufen, liefert Instanz B beim Init keinen Vorspann-Text", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, {}, async ({ a, b, sql, signer, wiedergaben, gesprochen }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    assert.equal((await ereignis(signer, a, { callId, art: "call.answered" })).status, HTTP_OK);
    await zeilenBis(async () => wiedergaben, (liste) => liste.length === 1);
    await sql("UPDATE vorspann_zustand SET expires_at = now() - interval '1 second' WHERE call_id = $1", [callId]);
    const eigene = await init(a, sql, callId);
    assert.equal(eigene.json.dynamic_variables.eroeffnung_gesagt, undefined);
    assert.ok(gesprochen.at(-1));
    const antwort = await init(b, sql, callId);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(antwort.json.dynamic_variables.eroeffnung_gesagt, undefined);
  });
});

test("Liefert der Anbieter keine Kennung fuer das Vorspann-Bein, bleibt keine Zeile zurueck", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { beiWahl: () => "ohne" }, async ({ a, sql }) => {
    assert.notEqual((await platziere(a)).status, HTTP_OK);
    assert.equal((await sql(ANZAHL_SQL)).rows[0].anzahl, 0);
  });
});

test("Wird der Anruf waehrend der Wahl abgebrochen, bleibt keine Zeile zurueck", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  let wahlFreigeben;
  const wahlFrei = new Promise((fertig) => (wahlFreigeben = fertig));
  let wahlGesehen;
  const wahlBeginn = new Promise((fertig) => (wahlGesehen = fertig));
  const beiWahl = async ({ command_id: kennung }) => {
    wahlGesehen(kennung.replace(/^vorspann-/, ""));
    await wahlFrei;
  };
  await mitAnbieter(t, { beiWahl }, async ({ a, sql }) => {
    const start = platziere(a);
    const callId = await wahlBeginn;
    const abbruch = await abrufMitFrist(`${a.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });
    assert.equal(abbruch.status, HTTP_OK);
    wahlFreigeben();
    await start;
    assert.equal((await sql(ANZAHL_SQL)).rows[0].anzahl, 0);
  });
});

test("Ist die Zeile beim Auflegen nicht lesbar, bleibt der Anruf aktiv und der Anbieter stellt neu zu", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, {}, async ({ a, sql, signer }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    await sql("ALTER TABLE vorspann_zustand RENAME TO vorspann_zustand_weg");
    assert.equal((await ereignis(signer, a, { callId, art: "call.hangup" })).status, HTTP_NICHT_ERREICHBAR);
    await zeilenBis(async () => a.stdout, (text) => text.includes(`[el-vorspann] ereignis fehlgeschlagen call=${callId}`));
    assert.equal((await sql("SELECT status FROM call WHERE id = $1", [callId])).rows[0].status, "active");
  });
});
