import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import konfiguration from "../../eslint.config.js";
import { OWNER_TEST_FIRST_NAME, nowSeconds, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { calleeVon, elVon, hebeAb, legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 5_000;
const OBERGRENZE_MS = 10_000;
const bestand = konfiguration.find((block) => block.name === "uhr-als-wert").ignores;

for (const datei of ["vorspann-ablauf.js", "vorspann-bruecke.js", "vorspann-ohne-zustand.js", "inbound-bridges.ts"]) {
  test(`uhr-vorspann: ${datei} steht nicht mehr im Uhr-Bestand`, () => {
    assert.ok(!bestand.includes(`src/elevenlabs/${datei}`));
  });
}

const umgebung = {};

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: "https://agent.test", kennung: "3407-vorspann" });
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

function sende(callId, typ, payload) {
  const roh = JSON.stringify({ data: { id: `evt-3407-${typ}-${callId}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

const messwert = (callId, messung, bezug) => {
  const ausgabe = umgebung.srv.stdout;
  const treffer = new RegExp(`${messung} ${bezug}=(-?\\d+) call=${callId}`).exec(ausgabe);
  return treffer ? Number(treffer[1]) : null;
};
const gemessen = (callId, messung, bezug) => waitUntil(() => messwert(callId, messung, bezug) !== null, { timeoutMs: WARTE_FRIST_MS });
const imFenster = (ms) => ms >= 0 && ms < OBERGRENZE_MS;

test("uhr-vorspann: die Messwerte des Vorspanns rechnen mit der Uhr des Aufrufers, Brücke und Zeitstempel entstehen", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(0));
  await hebeAb(umgebung.srv, umgebung.signer, callId);
  await gemessen(callId, "playback_start", "ms_seit_abheben");
  assert.ok(imFenster(messwert(callId, "playback_start", "ms_seit_abheben")));
  await sende(callId, "call.answered", { call_control_id: elVon(callId) });
  await gemessen(callId, "el_angenommen", "ms_seit_abheben");
  assert.ok(imFenster(messwert(callId, "el_angenommen", "ms_seit_abheben")));
  await sende(callId, "call.playback.ended", { call_control_id: calleeVon(callId), status: "completed" });
  await gemessen(callId, "bridge", "ms_seit_vorspann_ende");
  assert.ok(imFenster(messwert(callId, "bridge", "ms_seit_vorspann_ende")));
  const { srv } = umgebung;
  const anrufIn = () => srv.readStore().calls.find((eintrag) => eintrag.id === callId);
  await waitUntil(() => anrufIn().bridgedAt, { timeoutMs: WARTE_FRIST_MS });
});
