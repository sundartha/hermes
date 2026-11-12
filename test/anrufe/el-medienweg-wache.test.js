import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { medienwegAus, medienwegZeilen } from "../../src/elevenlabs/medienweg.js";
import { CONVERSATION_DONE_WITH_ANALYSIS, JOIN_SCHLUESSEL_ANRUF_2 } from "../fixtures/elevenlabs-conversations.js";
import { gebauteKonfiguration } from "../gemeinsam/gebaute-konfiguration.js";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";

const SCL_SID = JOIN_SCHLUESSEL_ANRUF_2.phoneCall.call_sid;
const OTB_SID = JOIN_SCHLUESSEL_ANRUF_2.phoneCall.call_id;
const CONVERSATION_ID = CONVERSATION_DONE_WITH_ANALYSIS.conversation_id;
const CALL_ID = "call_medienweg";
const FELD = "voice.elevenLabsOutbound.erwarteterMedienweg";
const ENV_NAME = "ELEVENLABS_ERWARTETER_MEDIENWEG";

const gespraechMit = (phoneCall) => ({ ...CONVERSATION_DONE_WITH_ANALYSIS, metadata: { phone_call: phoneCall } });
const mitSid = (callSid) => gespraechMit({ call_id: OTB_SID, call_sid: callSid });
const zeilenFuer = (callSid, erwartet) =>
  medienwegZeilen({ conversation: mitSid(callSid), callId: CALL_ID, conversationId: CONVERSATION_ID, erwartet });

test("medienwegAus leitet den Weg aus dem call_sid-Praefix ab", () => {
  const tabelle = [
    [mitSid(SCL_SID), "livekit"],
    [mitSid(OTB_SID), "sipgo"],
    [mitSid("xyz_1234"), "unbekannt"],
    [gespraechMit(undefined), null],
    [gespraechMit({ call_id: OTB_SID }), null],
    [null, null],
  ];
  for (const [gespraech, erwartet] of tabelle) assert.equal(medienwegAus(gespraech), erwartet);
});

test("medienwegZeilen: Logzeile je Gespraech, Abweichung nur bei anderem Weg als erwartet", () => {
  const sipgo = zeilenFuer(OTB_SID, "livekit");
  assert.match(sipgo.info, new RegExp(`^\\[el-medienweg\\] callId=${CALL_ID} conversationId=${CONVERSATION_ID} weg=sipgo call_sid_praefix=otb `));
  assert.match(sipgo.abweichung, /^\[el-medienweg-abweichung\] .* weg=sipgo erwartet=livekit$/);
  assert.equal(zeilenFuer(SCL_SID, "livekit").abweichung, null);
  assert.equal(zeilenFuer(OTB_SID, "").abweichung, null);
  assert.equal(zeilenFuer(OTB_SID, "sipgo").abweichung, null);
  assert.equal(medienwegZeilen({ conversation: gespraechMit(undefined), callId: CALL_ID, conversationId: CONVERSATION_ID, erwartet: "livekit" }), null);
});

test("die Konfiguration erwartet livekit, leer schaltet ab, sipgo ist waehlbar", () => {
  assert.equal(gebauteKonfiguration({}, [FELD])[FELD], "livekit");
  assert.equal(gebauteKonfiguration({ [ENV_NAME]: "" }, [FELD])[FELD], "");
  assert.equal(gebauteKonfiguration({ [ENV_NAME]: "sipgo" }, [FELD])[FELD], "sipgo");
});

async function startResultMock(gespraech) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(gespraech));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function ausgabeNachErgebnisabruf(gespraech) {
  const mock = await startResultMock(gespraech);
  const jetzt = new Date().toISOString();
  const aktiverAnruf = seedCall({ id: CALL_ID, provider: "telnyx", status: "active", answeredAt: jetzt, startedAt: jetzt, maxDurationS: 3600, elevenlabsConversationId: CONVERSATION_ID });
  const srv = await startServer({ env: { ELEVENLABS_API_BASE: mock.url, ELEVENLABS_API_KEY: "test-key" }, seed: seedState({ calls: [aktiverAnruf] }) });
  try {
    await waitForStoreState(srv, (state) => state.calls.find((eintrag) => eintrag.id === CALL_ID)?.status !== "active");
    return srv.stdout;
  } finally {
    await srv.stop();
    await mock.close();
  }
}

const zaehle = (ausgabe, praefix) => ausgabe.split("\n").filter((zeile) => zeile.startsWith(praefix)).length;

test("Ergebnisabruf eines otb_-Gespraechs bei Standard-Erwartung livekit: eine Logzeile, genau eine Abweichungswarnung", async () => {
  const ausgabe = await ausgabeNachErgebnisabruf(mitSid(OTB_SID));
  assert.equal(zaehle(ausgabe, "[el-medienweg] "), 1);
  assert.equal(zaehle(ausgabe, "[el-medienweg-abweichung]"), 1);
});

test("Ergebnisabruf eines SCL_-Gespraechs bei Standard-Erwartung livekit: Logzeile, keine Warnung", async () => {
  const ausgabe = await ausgabeNachErgebnisabruf(mitSid(SCL_SID));
  assert.equal(zaehle(ausgabe, "[el-medienweg] "), 1);
  assert.equal(zaehle(ausgabe, "[el-medienweg-abweichung]"), 0);
});
