import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, waitForLog, makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;

let laufnummer = 0;
const eindeutig = () => `m${(laufnummer += 1)}`;

const signer = makeTelnyxSigner();

const signiert = (body) => {
  const zeit = String(nowSeconds());
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    "telnyx-signature-ed25519": signer.sign(zeit, body),
    "telnyx-timestamp": zeit,
  };
};

const postRoh = (srv, pfad, felder) => {
  const body = new URLSearchParams(felder).toString();
  return abrufMitFrist(`${srv.localUrl}${pfad}`, { method: "POST", headers: signiert(body), body });
};

const post = (srv, pfad, felder) => postRoh(srv, pfad, { Marke: eindeutig(), ...felder });

const zeilenMit = (srv, marke) => srv.stdout.split("\n").filter((zeile) => zeile.includes(marke));

async function mitAnrufen(calls, pruefe) {
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
    seed: seedState({ calls }),
  });
  try {
    await pruefe(srv);
  } finally {
    await srv.stop();
  }
}

const wiederholungen = (srv, weg) => zeilenMit(srv, `wiederholte_zustellung weg=${weg} art=antwort_wiederholt`).length;

test("3395-R3-4: Rueckfall-Zustellung wird je Anruf und Quelle erkannt, eine andere Quelle oder ein anderer Anruf ist neu", async () => {
  await mitAnrufen([], async (srv) => {
    const rueckfall = (callId, quelle) => post(srv, `/voice/el-rueckfall?callId=${callId}&quelle=${quelle}`, {});
    await rueckfall("c_a", "dial_ende");
    await rueckfall("c_a", "dial_ende");
    await waitForLog(srv, /wiederholte_zustellung weg=el-rueckfall art=antwort_wiederholt/);
    assert.equal(wiederholungen(srv, "el-rueckfall"), 1);
    await rueckfall("c_a", "andere_quelle");
    await rueckfall("c_b", "dial_ende");
    await rueckfall("c_b", "dial_ende");
    await waitForLog(srv, /(wiederholte_zustellung weg=el-rueckfall art=antwort_wiederholt[\s\S]*){2}/);
    assert.equal(wiederholungen(srv, "el-rueckfall"), 2);
  });
});

test("3395-R3-5: SIP-Bein-Zustellung wird je Anruf und Status erkannt, ein anderer Status ist neu", async () => {
  await mitAnrufen([], async (srv) => {
    const bein = (status) => post(srv, "/voice/el-bein?callId=c_bein", { CallStatus: status });
    await bein("ringing");
    await bein("ringing");
    await bein("answered");
    await bein("answered");
    await bein("completed");
    await waitForLog(srv, /(wiederholte_zustellung weg=el-bein art=antwort_wiederholt[\s\S]*){2}/);
    assert.equal(wiederholungen(srv, "el-bein"), 2);
  });
});

test("3395-R3-6: zwei verschiedene signierte Zustellungen ohne Anruf-Kennung sind nie eine Wiederholung", async () => {
  await mitAnrufen([], async (srv) => {
    const ohneKennung = () => post(srv, "/voice/el-bein", { CallStatus: "ringing" });
    assert.equal((await ohneKennung()).status, HTTP_OK);
    assert.equal((await ohneKennung()).status, HTTP_OK);
    await waitForLog(srv, /voice-antwort\] weg=\/voice\/el-bein/);
    assert.equal(zeilenMit(srv, "wiederholte_zustellung").length, 0);
  });
});

test("4013-K3: Zustellung an /voice/el-bein mit ungueltiger Signatur wird nicht mit 200 beantwortet", async () => {
  await mitAnrufen([], async (srv) => {
    const body = new URLSearchParams({ SpeechResult: "" }).toString();
    const headers = { ...signiert(body), "telnyx-signature-ed25519": Buffer.alloc(64).toString("base64") };
    const res = await abrufMitFrist(`${srv.localUrl}/voice/el-bein?callId=c_x`, { method: "POST", headers, body });
    assert.notEqual(res.status, HTTP_OK);
  });
});
