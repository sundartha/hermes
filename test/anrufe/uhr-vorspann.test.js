import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import konfiguration from "../../eslint.config.js";
import { OWNER_TEST_FIRST_NAME, nowSeconds, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { calleeVon, elVon, hebeAb, legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 5_000;
const UHR_START_MS = 1_800_000_000_000;
const UHR_SCHRITT_MS = 1_000;
const VORSPANN_UHR = [
  "const echt = Date.now;",
  `let zeit = ${UHR_START_MS};`,
  "Date.now = () => {",
  "  const aufrufer = new Error().stack.split('\\n')[2] ?? '';",
  "  if (!/vorspann-(ablauf|bruecke|ohne-zustand)\\.js/.test(aufrufer)) return echt();",
  `  const jetzt = zeit; zeit += ${UHR_SCHRITT_MS}; return jetzt;`,
  "};",
].join("\n");
const BRUECKE_NACHLAUF_ID = "call_3407_nach_bruecke";
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
  const env = {
    ...vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: "https://agent.test", kennung: "3407-vorspann" }),
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(VORSPANN_UHR)}`,
  };
  const seed = seedState({
    tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }],
    calls: [
      seedCall({
        id: BRUECKE_NACHLAUF_ID,
        provider: "telnyx",
        answeredAt: new Date().toISOString(),
        bridgedAt: new Date().toISOString(),
        callControlId: calleeVon(BRUECKE_NACHLAUF_ID),
        elCallControlId: elVon(BRUECKE_NACHLAUF_ID),
      }),
    ],
  });
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

test("uhr-vorspann: die Messwerte des Vorspanns rechnen mit der Uhr des Aufrufers, Brücke und Zeitstempel entstehen", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(0));
  await hebeAb(umgebung.srv, umgebung.signer, callId);
  await gemessen(callId, "playback_start", "ms_seit_abheben");
  assert.equal(messwert(callId, "playback_start", "ms_seit_abheben"), UHR_SCHRITT_MS);
  await sende(callId, "call.answered", { call_control_id: elVon(callId) });
  await gemessen(callId, "el_angenommen", "ms_seit_abheben");
  assert.equal(messwert(callId, "el_angenommen", "ms_seit_abheben"), 3 * UHR_SCHRITT_MS);
  await sende(callId, "call.playback.ended", { call_control_id: calleeVon(callId), status: "completed" });
  await gemessen(callId, "bridge", "ms_seit_vorspann_ende");
  assert.equal(messwert(callId, "bridge", "ms_seit_vorspann_ende"), 2 * UHR_SCHRITT_MS);
  const { srv } = umgebung;
  const anrufIn = () => srv.readStore().calls.find((eintrag) => eintrag.id === callId);
  await waitUntil(() => anrufIn().bridgedAt, { timeoutMs: WARTE_FRIST_MS });
  assert.equal(anrufIn().bridgedAt, new Date(UHR_START_MS + 7 * UHR_SCHRITT_MS).toISOString());
});

test("uhr-vorspann: nach der Brücke ohne Prozesszustand legt das EL-Bein auf, der Anruf endet ohne EL-Vermerk", async () => {
  const { srv } = umgebung;
  await sende(BRUECKE_NACHLAUF_ID, "call.hangup", { call_control_id: elVon(BRUECKE_NACHLAUF_ID) });
  const anrufIn = () => srv.readStore().calls.find((eintrag) => eintrag.id === BRUECKE_NACHLAUF_ID);
  await waitUntil(() => anrufIn().status === "completed", { timeoutMs: WARTE_FRIST_MS });
  assert.ok(!anrufIn().failureReason);
  assert.ok(!anrufIn().elFallbackAt);
});
