import assert from "node:assert/strict";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { mitZweiHermesAufPostgres, zeilenBis } from "./hermes-mit-postgres.js";

export const HTTP_OK = 200;
export const AUDIO = Buffer.alloc(200_000, 0xab);
export const CALLEE_BEIN = "cc_callee_spaet";
export const EL_BEIN = "cc_el_spaet";
export const ZIEL = "+4915112399006";
export const ZUSTAND_FEHLT = "rueckfall grund=zustand_fehlt";
export const EL_BEIN_SQL = "SELECT el_call_control_id FROM call WHERE id = $1";
export const ABRECHNUNG_SQL = "SELECT billed_at FROM call WHERE id = $1";
export const SCHLUESSEL_SPERRE_SQL = "LOCK TABLE anruf_schluessel IN ACCESS EXCLUSIVE MODE";
export const NUTZUNG_SQL = "SELECT * FROM usage";

export const beinFuer = (roh) => (roh.includes('-el"') ? EL_BEIN : CALLEE_BEIN);

export function starteAnbieter() {
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

export function ereignis(signer, srv, { callId, art: eventType, kennung }) {
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

export const zaehleMarke = (instanzen, marke) => instanzen.reduce((summe, srv) => summe + srv.stdout.split(marke).length - 1, 0);

export async function mitAnbieter(t, lauf) {
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

export async function platziereUndHebeAb({ a, b, sql, signer, aufrufe }) {
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

export const elAuflegen = (aufrufe) => aufrufe.auflegen.filter((url) => url.includes(EL_BEIN));
