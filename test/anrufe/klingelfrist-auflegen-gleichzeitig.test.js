import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { OWNER_TEST_FIRST_NAME, nowSeconds, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { calleeVon, legeAnruf, makeTelnyxSigner, neueAnrufNummer, setzeVorAuflegenHaken, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 5_000;

const umgebung = {};
let gemeldet = false;

function meldeAufgelegt(callId) {
  const roh = JSON.stringify({ data: { id: `evt-6005-${callId}`, event_type: "call.hangup", payload: { call_control_id: calleeVon(callId) } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

const anrufe = () => umgebung.srv.readStore().calls;
const anrufIn = (callId) => anrufe().find((eintrag) => eintrag.id === callId);

beforeEach(async () => {
  gemeldet = false;
  setzeVorAuflegenHaken(async (url) => {
    if (gemeldet) return;
    gemeldet = true;
    await meldeAufgelegt(url.split("/")[3].replace("cc_callee_", ""));
  });
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: "https://agent.test", kennung: "6005-klingel" }),
    VORSPANN_KLINGEL_FRIST_MS: "300",
    FRISTEN_TAKT_MS: "200",
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  setzeVorAuflegenHaken(async () => {});
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

test("6005: trifft das Auflegen des Beins waehrend der Klingelfrist ein, endet der Anruf als no-answer und nicht als zustand_fehlt", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(10));
  await waitUntil(() => anrufIn(callId).status !== "active", { timeoutMs: WARTE_FRIST_MS });

  const call = anrufIn(callId);
  assert.equal(call.status, "failed");
  assert.equal(call.failureReason, "no-answer");
  assert.equal(gemeldet, true);
});
