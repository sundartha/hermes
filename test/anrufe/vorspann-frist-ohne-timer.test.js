import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { OWNER_TEST_FIRST_NAME, nowSeconds, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { calleeVon, elVon, hebeAb, legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 8_000;
const WIEDERGABE_FRIST_MS = 1733;
const EL_FRIST_MS = 2731;
const TAKT_MS = 200;
const ZEITGEBER = [
  "const echt = globalThis.setTimeout;",
  "globalThis.setTimeout = (fn, ms, ...rest) => {",
  `  if (ms === ${WIEDERGABE_FRIST_MS} || ms === ${EL_FRIST_MS}) console.log('vorspann-frist-timer ms=' + ms);`,
  "  return echt(fn, ms, ...rest);",
  "};",
].join("\n");

const umgebung = {};

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: "https://agent.test", kennung: "5928-4b" }),
    VORSPANN_WIEDERGABE_FRIST_MS: String(WIEDERGABE_FRIST_MS),
    EL_BRIDGE_START_DEADLINE_MS: String(EL_FRIST_MS),
    FRISTEN_TAKT_MS: String(TAKT_MS),
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(ZEITGEBER)}`,
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufIn = (callId) => umgebung.srv.readStore().calls.find((eintrag) => eintrag.id === callId);
const aufgelegt = (bein) => umgebung.attrappe.pfade.filter((pfad) => pfad.includes(bein) && pfad.endsWith("/actions/hangup")).length;
const beideAufgelegt = (callId) => aufgelegt(calleeVon(callId)) === 1 && aufgelegt(elVon(callId)) === 1;

function meldeWiedergabeEnde(callId) {
  const roh = JSON.stringify({ data: { id: `evt-5928-4b-${callId}`, event_type: "call.playback.ended", payload: { call_control_id: calleeVon(callId), status: "completed" } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

test("5928-4b K7: ohne Wiedergabe-Ende legt der Fristen-Takt beide Beine auf und vermerkt vorspann_nicht_abgespielt, im Prozess laeuft kein Timer dafuer", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(10));
  await hebeAb(umgebung.srv, umgebung.signer, callId);
  await waitUntil(() => beideAufgelegt(callId), { timeoutMs: WARTE_FRIST_MS });

  assert.equal(anrufIn(callId).failureReason, "vorspann_nicht_abgespielt");
  assert.equal(umgebung.srv.stdout.includes("vorspann-frist-timer"), false);
  assert.equal(umgebung.srv.stdout.split(`rueckfall grund=vorspann_nicht_abgespielt call=${callId}`).length - 1, 1);
});

test("5928-4b K7: ohne EL-Annahme legt der Fristen-Takt beide Beine auf und vermerkt el_frist, im Prozess laeuft kein Timer dafuer", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(11));
  await hebeAb(umgebung.srv, umgebung.signer, callId);
  await meldeWiedergabeEnde(callId);
  await waitUntil(() => beideAufgelegt(callId), { timeoutMs: WARTE_FRIST_MS });

  assert.equal(anrufIn(callId).failureReason, "el_frist");
  assert.equal(umgebung.srv.stdout.includes("vorspann-frist-timer"), false);
  assert.equal(umgebung.srv.stdout.split(`rueckfall grund=el_frist call=${callId}`).length - 1, 1);
});
