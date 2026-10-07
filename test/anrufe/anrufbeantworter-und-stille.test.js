import assert from "node:assert/strict";
import { test } from "node:test";
import { ANSWERED_BY, classifyAnsweredBy } from "../../src/telephony/answered-by.js";
import { noSpeechEscalation } from "../../src/no-speech-escalation.js";
import { startServer, seedState, seedCall } from "../helpers.js";
import { GATHER_OPEN, HANGUP_TAG, DISCLOSURE_JONAS } from "../_outbound-harness.js";

const HTTP_OK = 200;

const ZAHL_STATT_TOKEN = 42;
const ZWEITE_STILLE = 2;
const DRITTE_STILLE = 3;
const SIEBTE_STILLE = 7;

test("eindeutige Maschinen-Token -> MACHINE", () => {
  for (const token of [
    "machine_start",
    "machine_end_beep",
    "machine_end_silence",
    "machine_end_other",
    "fax",
  ]) {
    assert.equal(classifyAnsweredBy(token), ANSWERED_BY.MACHINE, `${token} muss MACHINE liefern`);
  }
});

test("human -> HUMAN", () => {
  assert.equal(classifyAnsweredBy("human"), ANSWERED_BY.HUMAN);
});

test("alles andere (fehlend/unbekannt) -> UNKNOWN (fail-open)", () => {
  for (const raw of ["", undefined, "weird", null, "MACHINE_START", ZAHL_STATT_TOKEN, {}]) {
    assert.equal(
      classifyAnsweredBy(raw),
      ANSWERED_BY.UNKNOWN,
      `${JSON.stringify(raw)} muss UNKNOWN liefern`,
    );
  }
});

const STUB_LOCALE = {
  noSpeechReprompt: "A",
  noSpeechRepromptAgain: "B",
  noSpeechFarewell: "C",
};

test("noSpeechEscalation: streak 1 -> Stufe 1 (Rueckfrage, kein Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(1, STUB_LOCALE), { speech: "A", endCall: false });
});

test("noSpeechEscalation: streak 2 -> Stufe 2 (deutlicher, kein Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(ZWEITE_STILLE, STUB_LOCALE), { speech: "B", endCall: false });
});

test("noSpeechEscalation: streak 3 -> Stufe 3 (Abschied + Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(DRITTE_STILLE, STUB_LOCALE), { speech: "C", endCall: true });
});

test("noSpeechEscalation: streak 7 (Uebersaettigung, z.B. Provider ignoriert Hangup) -> weiter Stufe 3", () => {
  assert.deepEqual(noSpeechEscalation(SIEBTE_STILLE, STUB_LOCALE), { speech: "C", endCall: true });
});

const CALL_ID = "call_amd1";
const CALL_SID = "CAtest";

async function fetchOutbound(env, answeredBy) {
  const srv = await startServer({
    env,
    seed: seedState({
      calls: [
        seedCall({ id: CALL_ID, provider: "telnyx", status: "active", direction: "outbound" }),
      ],
    }),
  });
  try {
    const body = new URLSearchParams({ CallSid: CALL_SID });
    if (answeredBy !== undefined) body.set("AnsweredBy", answeredBy);
    const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, {
      method: "POST",
      body,
    });
    return { status: res.status, body: await res.text() };
  } finally {
    await srv.stop();
  }
}

const FLAG_ON = { MACHINE_DETECTION_ENABLED: "true" };

test("Flag AN + AnsweredBy=machine_start -> Hangup, kein Say/Gather", async () => {
  const { status, body } = await fetchOutbound(FLAG_ON, "machine_start");
  assert.equal(status, HTTP_OK);
  assert.ok(body.includes(HANGUP_TAG), `Hangup erwartet: ${body}`);
  assert.ok(!body.includes(GATHER_OPEN), `kein Gather erwartet: ${body}`);
  assert.ok(!/<Say[ >]/.test(body), `kein Say erwartet: ${body}`);
});

test("Flag AN + AnsweredBy=unknown -> Bestands-XML mit Offenlegungssatz", async () => {
  const { status, body } = await fetchOutbound(FLAG_ON, "unknown");
  assert.equal(status, HTTP_OK);
  assert.ok(body.includes(GATHER_OPEN), `Gather erwartet: ${body}`);
  assert.ok(body.includes(DISCLOSURE_JONAS), `Offenlegung erwartet: ${body}`);
});

test("Flag AN + AnsweredBy=human -> Bestands-XML mit Offenlegungssatz", async () => {
  const { status, body } = await fetchOutbound(FLAG_ON, "human");
  assert.equal(status, HTTP_OK);
  assert.ok(body.includes(GATHER_OPEN), `Gather erwartet: ${body}`);
  assert.ok(body.includes(DISCLOSURE_JONAS), `Offenlegung erwartet: ${body}`);
});

test("Flag AUS + AnsweredBy=machine_start -> Bestands-XML (Rollback-Beweis)", async () => {
  const { status, body } = await fetchOutbound({}, "machine_start");
  assert.equal(status, HTTP_OK);
  assert.ok(body.includes(GATHER_OPEN), `Gather erwartet: ${body}`);
  assert.ok(body.includes(DISCLOSURE_JONAS), `Offenlegung erwartet: ${body}`);
});
