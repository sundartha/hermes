import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const AUDIO = Buffer.alloc(200_000, 0xab);
const TYP = "audio/mpeg";
const TTS_PFAD = "/v1/text-to-speech/";
const WIEDERGABE_ENDE = "/actions/playback_start";
const CALLEE_BEIN = "cc_callee_audio";
const ZIEL = "+4915112399001";

function starteAnbieterAttrappe(wiedergaben, elWahl) {
  return starteAttrappe((anfrage, antwort) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", async () => {
      if (anfrage.url.startsWith(TTS_PFAD)) {
        antwort.writeHead(HTTP_OK, { "content-type": TYP });
        return antwort.end(AUDIO);
      }
      if (anfrage.url.endsWith(WIEDERGABE_ENDE)) wiedergaben.push(JSON.parse(Buffer.concat(teile).toString()));
      else if (anfrage.url === "/v2/calls" && wiedergaben.length > 0) await elWahl;
      antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
      antwort.end(JSON.stringify({ data: { sid: "v3:audio", result: "ok", call_control_id: CALLEE_BEIN } }));
    });
  });
}

function signierterEreignisKoerper(signer, callId, eventType) {
  const rumpf = JSON.stringify({
    data: { id: `evt-${eventType}-${callId}`, event_type: eventType, payload: { call_control_id: CALLEE_BEIN, status: "ok" } },
  });
  const zeitstempel = String(nowSeconds());
  return {
    pfad: `/voice/vorspann?callId=${callId}`,
    optionen: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
        "telnyx-timestamp": zeitstempel,
      },
      body: rumpf,
    },
  };
}

const senden = (srv, { pfad, optionen }) => abrufMitFrist(`${srv.localUrl}${pfad}`, optionen);
const abrufen = (srv, token) => abrufMitFrist(`${srv.localUrl}/voice/tts/${token}`);

test("Vorspann-Audio eines auf Instanz A gestarteten Anrufs ist ueber Instanz B abrufbar, bis der Anruf aufgelegt wird", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  const signer = makeTelnyxSigner();
  const wiedergaben = [];
  let elWahlFreigeben;
  const elWahl = new Promise((fertig) => (elWahlFreigeben = fertig));
  const anbieter = await starteAnbieterAttrappe(wiedergaben, elWahl);
  t.after(() => anbieter.close());
  const env = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    ELEVENLABS_API_BASE: anbieter.url,
    TELNYX_API_BASE: anbieter.url,
  };
  await mitZweiHermesAufPostgres(t, { env }, async ({ a, b, sql }) => {
    const start = await abrufMitFrist(`${a.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
    });
    assert.equal(start.status, HTTP_OK, await start.clone().text());
    const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL]);
    assert.equal(rows.length, 1);
    const callId = rows[0].id;
    const abheben = senden(a, signierterEreignisKoerper(signer, callId, "call.answered"));
    const [{ audio_url: audioUrl }] = await zeilenBis(
      async () => wiedergaben,
      (liste) => liste.length === 1,
    );
    const token = audioUrl.split("/voice/tts/")[1];
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    for (const srv of [b, a, b]) {
      const antwort = await abrufen(srv, token);
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(antwort.headers.get("content-type"), TYP);
      assert.deepEqual(Buffer.from(await antwort.arrayBuffer()), AUDIO);
    }
    elWahlFreigeben();
    await abheben;
    await senden(a, signierterEreignisKoerper(signer, callId, "call.hangup"));
    await zeilenBis(
      async () => (await abrufen(b, token)).status,
      (status) => status === HTTP_NOT_FOUND,
    );
    assert.equal((await abrufen(a, token)).status, HTTP_NOT_FOUND);
    const uebrig = await sql("SELECT count(*)::int AS anzahl FROM tts_ablage");
    assert.equal(uebrig.rows[0].anzahl, 0);
  });
});
