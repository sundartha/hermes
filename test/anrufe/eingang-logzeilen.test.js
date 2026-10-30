import { test } from "node:test";
import assert from "node:assert/strict";

import { e164Endung } from "../../src/elevenlabs/inbound-path-decision.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { playTtsEnv, startSyntheseOrigin } from "../gemeinsam/play-tts-server.mjs";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  TELNYX_TEST_PEER_NUMBER,
  TELNYX_TEST_SIGNATURE_HEADERS,
  TELNYX_TEST_TENANT_NUMBER,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  startServer,
  waitForLog,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_BAD_REQUEST = 400;
const KOSTENDECKE_ERREICHT_ENV = Object.freeze({ MAX_BUDGET_EUR: "0" });
const ZEILEN_TRENNER = "\n";
const ABBRUCH_NACH_MS = 300;
const SYNTHESE_GESAMTFRIST_MS = "3000";
const OHNE_BELEG_ENV = Object.freeze({
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_SCOPE: "registrierte_dids",
  ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS: SYNTHESE_GESAMTFRIST_MS,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
});

async function mitServer(optionen, lauf) {
  const srv = await startServer(optionen);
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

const zeilenMit = (srv, marke) => srv.stdout.split(ZEILEN_TRENNER).filter((zeile) => zeile.includes(marke));
const alsRegex = (text) => new RegExp(text.replaceAll(/[[\]]/g, String.raw`\$&`));

test("Kostendecke erreicht: eine Logzeile mit Grund und Endung der Nummer, nie die volle Nummer", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: KOSTENDECKE_ERREICHT_ENV };
  await mitServer(optionen, async (srv) => {
    const res = await postTelnyxIncoming(srv);
    assert.match(await res.text(), /<Hangup\/>/);
    const erwartet = `[inbound] kostendecke to=${e164Endung(TELNYX_TEST_TENANT_NUMBER)}`;
    await waitForLog(srv, alsRegex(erwartet));
    assert.equal(zeilenMit(srv, "[inbound] kostendecke").length, 1);
    assert.ok(!srv.stdout.includes(TELNYX_TEST_TENANT_NUMBER), "keine volle Nummer im Log");
  });
});

test("Wiederholte Zustellung desselben Anrufs: Logzeile mit Weg und Art", async () => {
  await mitServer({ seed: seedWithTelnyxNumber({ language: "de" }) }, async (srv) => {
    await postTelnyxIncoming(srv, { callSid: "CAwiederholt" });
    await postTelnyxIncoming(srv, { callSid: "CAwiederholt" });
    await waitForLog(srv, /\[webhook-idempotenz\] wiederholte_zustellung weg=incoming art=antwort_wiederholt/);
    assert.equal(zeilenMit(srv, "wiederholte_zustellung weg=incoming").length, 1);
  });
});

test("Zustellung nach abgebrochener erster Verbindung: Logzeile neu_verarbeitet, nicht antwort_wiederholt", async () => {
  const origin = await startSyntheseOrigin(() => {});
  try {
    const optionen = {
      seed: seedWithTelnyxNumber({ language: "de" }),
      env: { ...OHNE_BELEG_ENV, ...playTtsEnv(origin.url) },
    };
    await mitServer(optionen, async (srv) => {
      const zustellung = (signal) =>
        abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
          method: "POST",
          headers: TELNYX_TEST_SIGNATURE_HEADERS,
          body: new URLSearchParams({ From: TELNYX_TEST_PEER_NUMBER, To: TELNYX_TEST_TENANT_NUMBER, CallSid: "CAabbruch" }),
          signal,
        });
      await assert.rejects(zustellung(AbortSignal.timeout(ABBRUCH_NACH_MS)));
      await zustellung();
      await waitForLog(srv, /\[webhook-idempotenz\] wiederholte_zustellung weg=incoming art=neu_verarbeitet/);
      assert.equal(zeilenMit(srv, "art=antwort_wiederholt").length, 0);
      assert.equal(zeilenMit(srv, "art=neu_verarbeitet").length, 1);
    });
  } finally {
    await origin.close();
  }
});

test("Wiederholung nach Neustart: Logzeile mit Art keepalive", async () => {
  const erster = await startServer({ seed: seedWithTelnyxNumber({ language: "de" }) });
  let dataDir;
  try {
    await postTelnyxIncoming(erster, { callSid: "CAneustart" });
    ({ dataDir } = erster);
  } finally {
    await erster.stop();
  }
  await mitServer({ dataDir }, async (srv) => {
    await postTelnyxIncoming(srv, { callSid: "CAneustart" });
    await waitForLog(srv, /\[webhook-idempotenz\] wiederholte_zustellung weg=incoming art=keepalive/);
    assert.equal(zeilenMit(srv, "art=keepalive").length, 1);
  });
});

test("Unlesbarer Body an /voice/incoming: Antwort 400 und Logzeile mit Status und Typ", async () => {
  await mitServer({ seed: seedWithTelnyxNumber({ language: "de" }) }, async (srv) => {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      headers: { ...TELNYX_TEST_SIGNATURE_HEADERS, "Content-Type": "application/json" },
      body: "{kaputt",
    });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    await waitForLog(srv, /\[voice\] body_abgelehnt status=400 typ=entity\.parse\.failed/);
    assert.equal(zeilenMit(srv, "[voice] body_abgelehnt").length, 1);
  });
});

const EL_ALLOWLIST_ENV = Object.freeze({
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
});

const postVoice = (srv, pfad, body) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams(body),
  });

test("Wiederholte Gespraechsrunde und wiederholter Rueckfall: Logzeile mit dem Weg des Webhooks", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: EL_ALLOWLIST_ENV };
  await mitServer(optionen, async (srv) => {
    await postTelnyxIncoming(srv, { callSid: "CArunde" });
    const [{ id: callId }] = srv.readStore().calls;
    const rueckfall = `/voice/el-rueckfall?callId=${callId}&quelle=dial_ende`;
    await postVoice(srv, rueckfall, { Quelle: "rueckfall" });
    await postVoice(srv, rueckfall, { Quelle: "rueckfall" });
    await postVoice(srv, "/voice/turn?callId=call_unbekannt&turnToken=wiederholt", { Quelle: "runde" });
    await postVoice(srv, "/voice/turn?callId=call_unbekannt&turnToken=wiederholt", { Quelle: "runde" });
    await waitForLog(srv, /wiederholte_zustellung weg=el-rueckfall art=antwort_wiederholt/);
    await waitForLog(srv, /wiederholte_zustellung weg=turn art=antwort_wiederholt/);
    assert.equal(zeilenMit(srv, "wiederholte_zustellung weg=el-rueckfall").length, 1);
    assert.equal(zeilenMit(srv, "wiederholte_zustellung weg=turn").length, 1);
  });
});

test("Jede Antwort der Voice-Webhooks: eine Logzeile mit Dauer, Status und Ende", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: EL_ALLOWLIST_ENV };
  await mitServer(optionen, async (srv) => {
    await postTelnyxIncoming(srv, { callSid: "CAdauer" });
    const [{ id: callId }] = srv.readStore().calls;
    await postVoice(srv, `/voice/el-rueckfall?callId=${callId}&quelle=dial_ende`, { Quelle: "dauer" });
    await waitForLog(srv, /\[voice-antwort\] weg=\/voice\/incoming ms=\d+ status=200 ende=beendet/);
    await waitForLog(srv, /\[voice-antwort\] weg=\/voice\/el-rueckfall ms=\d+ status=200 ende=beendet/);
    assert.equal(zeilenMit(srv, "[voice-antwort] weg=/voice/incoming").length, 1);
    assert.equal(zeilenMit(srv, "[voice-antwort] weg=/voice/el-rueckfall").length, 1);
    assert.ok(!srv.stdout.includes(TELNYX_TEST_TENANT_NUMBER), "keine volle Nummer im Log");
  });
});
