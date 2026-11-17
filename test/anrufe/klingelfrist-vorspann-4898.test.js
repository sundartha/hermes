import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { OWNER_TEST_FIRST_NAME, nowSeconds, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { calleeVon, hebeAb, legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 5_000;
const KLINGEL_FRIST_MS = 75_000;
const VERKUERZT_MS = 300;
const HTTP_OK = 200;
const ZEITGEBER = [
  "const echt = globalThis.setTimeout;",
  "globalThis.setTimeout = (fn, ms, ...rest) => {",
  `  if (ms !== ${KLINGEL_FRIST_MS}) return echt(fn, ms, ...rest);`,
  "  console.log('klingelfrist-gestellt ms=' + ms);",
  "  return echt(async () => {",
  "    try { await fn(...rest); } finally { console.log('klingelfrist-fertig'); }",
  `  }, ${VERKUERZT_MS});`,
  "};",
].join("\n");

const umgebung = {};

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: "https://agent.test", kennung: "4898-klingel" }),
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
const fristFertig = () => waitUntil(() => umgebung.srv.stdout.includes("klingelfrist-fertig"), { timeoutMs: WARTE_FRIST_MS });
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

test("4898 K3: die gestellte Frist ist genau 75000 ms und wird einmal gestellt", async () => {
  await legeAnruf(umgebung.srv, neueAnrufNummer(1));
  await fristFertig();

  assert.equal(umgebung.srv.stdout.match(/klingelfrist-gestellt ms=75000/g).length, 1);
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
