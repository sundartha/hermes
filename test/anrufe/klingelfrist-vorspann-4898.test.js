import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { OWNER_TEST_FIRST_NAME, nowSeconds, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { calleeVon, hebeAb, legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 5_000;
const HTTP_OK = 200;
const SCHRANKEN_ANRUF = 40;

const umgebung = {};

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: "https://agent.test", kennung: "4898-klingel" }),
    VORSPANN_KLINGEL_FRIST_MS: "300",
    FRISTEN_TAKT_MS: "200",
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufe = () => umgebung.srv.readStore().calls;
const anrufIn = (callId) => anrufe().find((eintrag) => eintrag.id === callId);
async function fristFertig() {
  const schranke = await legeAnruf(umgebung.srv, neueAnrufNummer(SCHRANKEN_ANRUF));
  await waitUntil(() => anrufIn(schranke).status !== "active", { timeoutMs: WARTE_FRIST_MS });
}
const calleeAufgelegt = (callId) => umgebung.attrappe.pfade.some((pfad) => pfad.includes(calleeVon(callId)) && pfad.endsWith("/actions/hangup"));

test("4898 K1: wird das Vorspann-Bein nie abgehoben und kommt kein Webhook, ist der Anruf nach der Frist failed/no-answer und das Bein aufgelegt", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(0));
  await fristFertig();
  await waitUntil(() => anrufIn(callId).status !== "active", { timeoutMs: WARTE_FRIST_MS });

  const call = anrufIn(callId);
  assert.equal(call.status, "failed");
  assert.equal(call.failureReason, "no-answer");
  assert.equal(call.answeredAt ?? null, null);
  assert.equal(calleeAufgelegt(callId), true);
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls/${callId}`);
  assert.equal(antwort.status, HTTP_OK);
  const sicht = await antwort.json();
  assert.equal(sicht.status, "failed");
  assert.equal(sicht.failureReason, "no-answer");
});

const istCalleeAuflegen = (callId) => (pfad) => pfad.includes(calleeVon(callId)) && pfad.endsWith("/actions/hangup");
const calleeAuflegeAnfragen = (callId) => {
  const { pfade } = umgebung.attrappe;
  return pfade.filter(istCalleeAuflegen(callId)).length;
};

test("4898 K3: die Klingelfrist feuert genau einmal", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(1));
  await fristFertig();

  assert.equal(calleeAuflegeAnfragen(callId), 1);
});

test("4898 K4: nach dem Abheben aendert der Ablauf der Frist nichts, der Anruf bleibt aktiv und das Bein wird nicht aufgelegt", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(2));
  await hebeAb(umgebung.srv, umgebung.signer, callId);
  await fristFertig();

  const call = anrufIn(callId);
  assert.equal(call.status, "active");
  assert.ok(call.answeredAt);
  assert.equal(calleeAufgelegt(callId), false);
});

function meldeAufgelegt(callId) {
  const roh = JSON.stringify({ data: { id: `evt-4898-${callId}`, event_type: "call.hangup", payload: { call_control_id: calleeVon(callId) } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

test("4898: war der Anruf schon per Webhook als nicht angenommen beendet, legt die Frist nichts mehr auf", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(3));
  await meldeAufgelegt(callId);
  await waitUntil(() => anrufIn(callId).status === "failed", { timeoutMs: WARTE_FRIST_MS });
  await fristFertig();

  assert.equal(anrufIn(callId).failureReason, "no-answer");
  assert.equal(calleeAufgelegt(callId), false);
});

test("4898: war der Anruf schon abgebrochen, bevor die Frist ablaeuft, bleibt er abgebrochen und das Bein wird kein zweites Mal aufgelegt", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(4));
  const abbruch = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });
  assert.equal(abbruch.status, HTTP_OK);
  await fristFertig();

  assert.equal(anrufIn(callId).status, "cancelled");
  assert.equal(anrufIn(callId).failureReason ?? null, null);
  assert.equal(calleeAuflegeAnfragen(callId), 1);
});
