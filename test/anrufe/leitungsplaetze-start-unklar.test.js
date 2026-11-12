import assert from "node:assert/strict";
import test from "node:test";

import { seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const EL_START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const KONVERSATION_PFAD = "/v1/convai/conversations/";
const TELNYX_START_PFAD = "/v2/texml/calls/";
const TELNYX_ENV = Object.freeze({
  TELNYX_API_KEY: "KEYtest-su-schluessel",
  TELNYX_CONNECTION_ID: "conn_su",
  TELNYX_ACCOUNT_SID: "acct_su",
});
const TELNYX_PLAETZE = 90;
const ANRUFE_PRO_KUNDE = 2;
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

function starteAnbieter({ startPfad, startNummerMitFehler, scheitertMit, erfolg }) {
  let starts = 0;
  return starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      if (!req.url.startsWith(startPfad)) {
        res.writeHead(HTTP_OK, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...CONVERSATION_IN_PROGRESS, conversation_id: req.url.slice(KONVERSATION_PFAD.length) }));
        return;
      }
      starts += 1;
      if (starts === startNummerMitFehler) {
        if (scheitertMit === null) return req.socket.destroy();
        res.writeHead(scheitertMit);
        return res.end();
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify(erfolg(starts)));
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

const WEGE = [
  {
    name: "ElevenLabs",
    kunden: 4,
    belegt: 3,
    startPfad: EL_START_PFAD,
    erfolg: (nummer) => ({ success: true, conversation_id: `conv_su_${nummer}`, sip_call_id: "sip_su" }),
    env: (url) => ({ ...EL_WEG, ELEVENLABS_API_BASE: url }),
  },
  {
    name: "Telnyx",
    kunden: TELNYX_PLAETZE / ANRUFE_PRO_KUNDE + 1,
    belegt: TELNYX_PLAETZE - 1,
    startPfad: TELNYX_START_PFAD,
    erfolg: (nummer) => ({ sid: `tnx_su_${nummer}` }),
    env: (url) => ({ ...TELNYX_ENV, TELNYX_API_BASE: url }),
  },
];

const FAELLE = [
  { name: "HTTP 500", scheitertMit: 500, antwort: 502, frei: false, grund: "result-unknown:start-500" },
  { name: "Verbindung ohne Antwort abgebrochen", scheitertMit: null, antwort: 500, frei: false, grund: "result-unknown:start-no-status" },
  { name: "HTTP 400", scheitertMit: 400, antwort: 502, frei: true, grund: "not-placed:start-400" },
  { name: "HTTP 422", scheitertMit: 422, antwort: 502, frei: true, grund: "not-placed:start-422" },
  { name: "HTTP 429", scheitertMit: 429, antwort: 502, frei: true, grund: "at-capacity:start-429" },
];

async function belegePlaetze(srv, anzahl) {
  for (let nummer = 1; nummer <= anzahl; nummer += 1)
    assert.equal(await rufeAn(srv, Math.floor((nummer - 1) / ANRUFE_PRO_KUNDE), nummer), HTTP_OK, `Anruf ${nummer}`);
}

for (const weg of WEGE)
  for (const fall of FAELLE) {
    test(`${weg.name}-Startfehler ${fall.name}: Platz ${fall.frei ? "sofort frei" : "bleibt belegt"}, Kundenantwort ${fall.antwort}, Grund ${fall.grund}`, async () => {
      const anbieter = await starteAnbieter({
        startPfad: weg.startPfad,
        startNummerMitFehler: weg.belegt + 1,
        scheitertMit: fall.scheitertMit,
        erfolg: weg.erfolg,
      });
      const srv = await startServer({ env: weg.env(anbieter.url), seed: seedKunden(weg.kunden) });
      try {
        await belegePlaetze(srv, weg.belegt);
        const fehlerNummer = weg.belegt + 1;
        const fehlerKunde = Math.floor(weg.belegt / ANRUFE_PRO_KUNDE);
        assert.equal(await rufeAn(srv, fehlerKunde, fehlerNummer), fall.antwort, "Antwort an den Kunden beim Startfehler");
        const stand = await waitForStoreState(srv, (s) => s.calls.some((call) => call.status === "failed" && Boolean(call.billedAt)));
        assert.deepEqual(stand.calls.filter((call) => call.status === "failed").map((call) => call.failureReason), [fall.grund]);
        assert.equal(await rufeAn(srv, weg.kunden - 1, fehlerNummer + 1), fall.frei ? HTTP_OK : HTTP_UNAVAILABLE);
      } finally {
        await srv.stop();
        await anbieter.close();
      }
    });
  }
