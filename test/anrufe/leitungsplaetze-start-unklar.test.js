import assert from "node:assert/strict";
import test from "node:test";

import { seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { requestNotSent, startRejectionReason } from "../../src/telephony/failure-reason.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const KONVERSATION_PFAD = "/v1/convai/conversations/";
const BELEGTE_PLAETZE_VOR_DEM_FEHLER = 3;
const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_su",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_su",
  ELEVENLABS_API_KEY: "el-su-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

const kundeVon = (index) => `t_su_${index}`;
const zielVon = (nummer) => `+1202555${String(6000 + nummer).padStart(4, "0")}`;

function seedKunden(anzahl) {
  const indizes = Array.from({ length: anzahl }, (_, index) => index);
  return seedState({
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: "en",
    })),
    numbers: indizes.map((index) => ({
      id: `num_su_${index}`,
      e164: `+1202555${String(3000 + index).padStart(4, "0")}`,
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_su_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

function starteAnbieter(scheitertMit) {
  let starts = 0;
  return starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      if (!req.url.startsWith(START_PFAD)) {
        res.writeHead(HTTP_OK, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...CONVERSATION_IN_PROGRESS, conversation_id: req.url.slice(KONVERSATION_PFAD.length) }));
        return;
      }
      starts += 1;
      if (starts === BELEGTE_PLAETZE_VOR_DEM_FEHLER + 1) {
        if (scheitertMit === null) return req.socket.destroy();
        res.writeHead(scheitertMit);
        return res.end();
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, conversation_id: `conv_su_${starts}`, sip_call_id: "sip_su" }));
    });
  });
}

async function rufeAn(srv, index, nummer) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: zielVon(nummer), objective: "Tisch reservieren (Startfehler)" }),
  });
  return res.status;
}

const FAELLE = [
  { name: "HTTP 500", scheitertMit: 500, antwort: 502, frei: false },
  { name: "Verbindung ohne Antwort abgebrochen", scheitertMit: null, antwort: 500, frei: false },
  { name: "HTTP 400", scheitertMit: 400, antwort: 502, frei: true },
  { name: "HTTP 422", scheitertMit: 422, antwort: 502, frei: true },
  { name: "HTTP 429", scheitertMit: 429, antwort: 502, frei: true },
];

for (const fall of FAELLE) {
  test(`Startfehler ${fall.name}: Platz ${fall.frei ? "sofort frei" : "bleibt belegt"}, Kundenantwort ${fall.antwort}`, async () => {
    const anbieter = await starteAnbieter(fall.scheitertMit);
    const srv = await startServer({ env: { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url }, seed: seedKunden(4) });
    try {
      assert.equal(await rufeAn(srv, 0, 1), HTTP_OK);
      assert.equal(await rufeAn(srv, 0, 2), HTTP_OK);
      assert.equal(await rufeAn(srv, 1, 3), HTTP_OK);
      assert.equal(await rufeAn(srv, 2, 4), fall.antwort, "Antwort an den Kunden beim Startfehler");
      assert.equal(await rufeAn(srv, 3, 5), fall.frei ? HTTP_OK : HTTP_UNAVAILABLE);
    } finally {
      await srv.stop();
      await anbieter.close();
    }
  });
}

const GRUND_TABELLE = [
  { name: "ohne Status und Request nicht gesendet", status: undefined, nichtGesendet: true, erwartet: "not-placed:start-refused" },
  { name: "ohne Status, Request moeglicherweise gesendet", status: undefined, nichtGesendet: false, erwartet: "result-unknown:start-no-status" },
  { name: "500 gewinnt vor nicht gesendet", status: 500, nichtGesendet: true, erwartet: "result-unknown:start-500" },
  { name: "400 gewinnt vor nicht gesendet", status: 400, nichtGesendet: true, erwartet: "not-placed:start-400" },
  { name: "429 bleibt at-capacity", status: 429, nichtGesendet: false, erwartet: "at-capacity:start-429" },
];

for (const zeile of GRUND_TABELLE) {
  test(`Startgrund: ${zeile.name}`, () => {
    assert.equal(startRejectionReason(zeile.status, zeile.nichtGesendet), zeile.erwartet);
  });
}

const NICHT_GESENDET_TABELLE = [
  { name: "Verbindung abgelehnt", fehler: { cause: { code: "ECONNREFUSED" } }, erwartet: true },
  { name: "Name nicht aufloesbar", fehler: { cause: { code: "ENOTFOUND" } }, erwartet: true },
  { name: "gesperrter Port", fehler: { cause: { message: "bad port" } }, erwartet: true },
  { name: "Verbindung zurueckgesetzt", fehler: { cause: { code: "ECONNRESET" } }, erwartet: false },
  { name: "anderer Ursachentext", fehler: { cause: { message: "bad port number" } }, erwartet: false },
  { name: "ohne Ursache", fehler: new Error("Zeitueberschreitung"), erwartet: false },
  { name: "kein Fehlerobjekt", fehler: undefined, erwartet: false },
];

for (const zeile of NICHT_GESENDET_TABELLE) {
  test(`Request nicht gesendet: ${zeile.name}`, () => {
    assert.equal(requestNotSent(zeile.fehler), zeile.erwartet);
  });
}
