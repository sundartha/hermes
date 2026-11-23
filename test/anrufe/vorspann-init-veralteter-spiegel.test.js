import assert from "node:assert/strict";
import test from "node:test";

import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.ts";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds, EL_INBOUND_ACCESS_BOOT_ENV } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_NICHT_GEFUNDEN = 404;
const AUDIO = Buffer.alloc(200_000, 0xab);
const CALLEE_BEIN = "cc_callee_spiegel";
const EL_BEIN = "cc_el_spiegel";
const ZIEL = "+4915112399003";
const AGENT_ID = "agent_pg";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const ABLAUF_SQL = "UPDATE vorspann_zustand SET expires_at = now() - interval '1 second' WHERE call_id = $1";
const GEBUNDEN_SQL = "SELECT status, el_bound_at FROM call WHERE id = $1";
const ABGELEHNT = "[el-init] abgelehnt";

const beinFuer = (roh) => (roh.includes("-el\"") ? EL_BEIN : CALLEE_BEIN);

async function starteAnbieter() {
  const wiedergaben = [];
  const anfrageVon = (anfrage) =>
    new Promise((fertig) => {
      const teile = [];
      anfrage.on("data", (stueck) => teile.push(stueck));
      anfrage.on("end", () => fertig(Buffer.concat(teile).toString()));
    });
  const attrappe = await starteAttrappe(async (anfrage, antwort) => {
    const roh = await anfrageVon(anfrage);
    if (anfrage.url.startsWith("/v1/text-to-speech/")) {
      antwort.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      return antwort.end(AUDIO);
    }
    if (anfrage.url.endsWith("/actions/playback_start")) wiedergaben.push(JSON.parse(roh));
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ data: { sid: "v3:spiegel", result: "ok", call_control_id: beinFuer(roh) } }));
  });
  return { attrappe, wiedergaben };
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

async function init(srv, sql, { callId, konversation = `conv_${callId}` }) {
  const { rows } = await sql("SELECT stream_token, from_e164 FROM call WHERE id = $1", [callId]);
  const antwort = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: konversation,
      called_number: rows[0].from_e164,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: rows[0].stream_token },
    }),
  });
  return { status: antwort.status, json: await antwort.json() };
}

const abgelehnteZeilen = (text) => text.split("\n").filter((zeile) => zeile.includes(ABGELEHNT));

const meldung = (antwort, instanz) => `${JSON.stringify(antwort)} ${abgelehnteZeilen(instanz.stdout).join(" | ")}`;

async function mitVeraltetemSpiegel(t, lauf) {
  const signer = makeTelnyxSigner();
  const { attrappe, wiedergaben } = await starteAnbieter();
  t.after(() => attrappe.close());
  const env = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    ELEVENLABS_API_BASE: attrappe.url,
    TELNYX_API_BASE: attrappe.url,
  };
  await mitZweiHermesAufPostgres(t, { env }, async ({ a, b, sql }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = (await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL])).rows[0].id;
    assert.equal((await ereignis(signer, b, { callId, art: "call.initiated" })).status, HTTP_OK);
    assert.equal((await ereignis(signer, a, { callId, art: "call.answered" })).status, HTTP_OK);
    await zeilenBis(async () => wiedergaben, (liste) => liste.length === 1);
    await sql(ABLAUF_SQL, [callId]);
    await lauf({ a, b, sql, signer, callId });
  });
}

test("Instanz B mit veraltetem Spiegel bindet beim ersten Init am Stand der Datenbank", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitVeraltetemSpiegel(t, async ({ b, sql, callId }) => {
    const antwort = await init(b, sql, { callId });
    assert.equal(antwort.status, HTTP_OK, meldung(antwort, b));
    assert.equal(antwort.json.dynamic_variables.eroeffnung_gesagt, undefined);
    assert.ok(!b.stdout.includes(ABGELEHNT), meldung(antwort, b));
  });
});

test("Instanz B mit veraltetem Spiegel nimmt die Wiederholung nach dem Init auf Instanz A an", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitVeraltetemSpiegel(t, async ({ a, b, sql, signer, callId }) => {
    const eigene = await init(a, sql, { callId });
    assert.equal(eigene.status, HTTP_OK);
    const antwort = await init(b, sql, { callId });
    assert.equal(antwort.status, HTTP_OK, meldung(antwort, b));
    assert.equal(antwort.json.dynamic_variables.eroeffnung_gesagt, undefined);
    assert.ok(!b.stdout.includes(ABGELEHNT), meldung(antwort, b));
    assert.ok(b.stdout.includes(`[el-init] wiederholung call=${callId}`), meldung(antwort, b));
    const vorher = (await sql(GEBUNDEN_SQL, [callId])).rows[0];
    assert.ok(vorher.el_bound_at);
    assert.equal((await ereignis(signer, b, { callId, art: "call.hangup" })).status, HTTP_OK);
    await zeilenBis(async () => (await sql(GEBUNDEN_SQL, [callId])).rows[0].status, (status) => status !== "active");
    assert.deepEqual((await sql(GEBUNDEN_SQL, [callId])).rows[0].el_bound_at, vorher.el_bound_at);
  });
});

test("Ist der Anruf in der Datenbank an eine andere Konversation gebunden, lehnt Instanz B den Init trotz veraltetem Spiegel ab", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitVeraltetemSpiegel(t, async ({ a, b, sql, callId }) => {
    assert.equal((await init(a, sql, { callId })).status, HTTP_OK);
    const antwort = await init(b, sql, { callId, konversation: "conv_fremd" });
    assert.equal(antwort.status, HTTP_NICHT_GEFUNDEN);
    assert.match(b.stdout, /\[el-init\] abgelehnt grund=kein_wartender_anruf/);
  });
});

test("Ist der Anruf in der Datenbank beendet, lehnt Instanz B den Init trotz veraltetem Spiegel ab", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitVeraltetemSpiegel(t, async ({ a, b, sql, signer, callId }) => {
    assert.equal((await ereignis(signer, a, { callId, art: "call.hangup" })).status, HTTP_OK);
    await zeilenBis(async () => (await sql("SELECT status FROM call WHERE id = $1", [callId])).rows[0].status, (status) => status !== "active");
    const antwort = await init(b, sql, { callId });
    assert.equal(antwort.status, HTTP_NICHT_GEFUNDEN);
    assert.match(b.stdout, /\[el-init\] abgelehnt grund=kein_wartender_anruf/);
  });
});
