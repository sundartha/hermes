import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";
import { starteJsonAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const CAP_VORLAUF_MS = "20000";
const KNAPPE_RESTZEIT_S = 20;
const GROSSZUEGIGE_RESTZEIT_S = 180;
const LEERE_ZUEGE_BIS_AUFLEGEN = 3;
const CAP_ABSCHIED =
  /<Say[^>]*>Ich muss das Gespräch jetzt leider beenden\. Vielen Dank für Ihre Zeit\. Auf Wiederhören\.<\/Say>/;
const ERSTE_NACHFRAGE = /<Say[^>]*>Können Sie das bitte wiederholen\?<\/Say>/;
const ZWEITE_NACHFRAGE =
  /<Say[^>]*>Ich höre Sie leider immer noch nicht\. Sind Sie noch in der Leitung\?<\/Say>/;
const STILLE_ABSCHIED =
  /<Say[^>]*>Ich kann Sie leider nicht hören\. Ich versuche es später noch einmal\. Auf Wiederhören\.<\/Say>/;
const SCHWEIGENDER_ANRUFER = [{ role: "caller", text: "..." }];

function assistentenAntwort(id, content, stopReason) {
  return {
    id,
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 6 },
  };
}

function textMessage(text) {
  return assistentenAntwort("msg_p3c_text", [{ type: "text", text }], "end_turn");
}

function endCallMessage(speech) {
  return assistentenAntwort(
    "msg_g326_endcall",
    [
      { type: "text", text: speech },
      { type: "tool_use", id: "tu1", name: "end_call", input: {} },
    ],
    "tool_use",
  );
}

function startModellAttrappe(antwort) {
  return starteJsonAttrappe(antwort);
}

function startAktiverAnruf({ id, env = {}, maxDurationS, transcript }) {
  const felder = { id, provider: "telnyx", status: "active", direction: "outbound" };
  if (maxDurationS !== undefined) felder.maxDurationS = maxDurationS;
  if (transcript !== undefined) felder.transcript = transcript;
  return startServer({ env, seed: seedState({ calls: [seedCall(felder)] }) });
}

async function zug(srv, id, speechResult) {
  const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ SpeechResult: speechResult }),
  });
  return { status: res.status, body: await res.text() };
}

async function capZug({ id, maxDurationS }) {
  const mock = await startModellAttrappe(textMessage("Und wie lange dauert das ungefaehr?"));
  const srv = await startAktiverAnruf({
    id,
    env: { ANTHROPIC_BASE_URL: mock.url, CAP_FAREWELL_LEAD_MS: CAP_VORLAUF_MS },
    maxDurationS,
    transcript: [{ role: "caller", text: "Ja gerne" }],
  });
  try {
    return await zug(srv, id, "Und wie lange dauert das?");
  } finally {
    await srv.stop();
    await mock.close();
  }
}

test("P3-C1: Restzeit unter CAP_FAREWELL_LEAD_MS -> Abschluss-Satz + Hangup statt Folge-Gather", async () => {
  const { status, body } = await capZug({ id: "call_p3c1", maxDurationS: KNAPPE_RESTZEIT_S });
  assert.equal(status, HTTP_OK);
  assert.match(body, CAP_ABSCHIED);
  assert.match(body, /<Hangup/);
  assert.doesNotMatch(body, /<Gather/, `Cap-Vorlauf darf keinen Folge-Gather rendern: ${body}`);
});

test("P3-C2 (Gegenprobe): grosszuegige Restzeit -> normaler Turn, kein Cap-Abschied", async () => {
  const { status, body } = await capZug({ id: "call_p3c2", maxDurationS: GROSSZUEGIGE_RESTZEIT_S });
  assert.equal(status, HTTP_OK);
  assert.match(body, /<Gather/);
  assert.doesNotMatch(body, /<Hangup/);
  assert.doesNotMatch(
    body,
    /Ich muss das Gespräch jetzt leider beenden/,
    `Cap-Abschied darf bei grosszuegiger Restzeit nicht rendern: ${body}`,
  );
});

test("P3-COV1: leerer Gather UND Restzeit unter CAP_FAREWELL_LEAD_MS -> Abschluss-Satz statt Staffel-Stufe-1", async () => {
  const id = "call_p3cov1";
  const srv = await startAktiverAnruf({
    id,
    env: { CAP_FAREWELL_LEAD_MS: CAP_VORLAUF_MS },
    maxDurationS: KNAPPE_RESTZEIT_S,
    transcript: SCHWEIGENDER_ANRUFER,
  });
  try {
    const { status, body } = await zug(srv, id, "");
    assert.equal(status, HTTP_OK);
    assert.match(body, CAP_ABSCHIED);
    assert.match(body, /<Hangup/);
    assert.doesNotMatch(body, /<Gather/, `Cap-Vorlauf darf keinen Folge-Gather rendern: ${body}`);
    assert.doesNotMatch(
      body,
      /Können Sie das bitte wiederholen/,
      `Staffel-Stufe-1 darf bei knapper Restzeit nicht rendern, der Cap-Vorlauf muss gewinnen: ${body}`,
    );
  } finally {
    await srv.stop();
  }
});

test("G4: leerer Gather nach bereits-gesprochenem Caller -> knappe Rueckfrage, kein Hangup", async () => {
  const id = "call_g4";
  const srv = await startAktiverAnruf({ id, transcript: SCHWEIGENDER_ANRUFER });
  try {
    const { status, body } = await zug(srv, id, "");
    assert.equal(status, HTTP_OK);
    assert.match(body, ERSTE_NACHFRAGE);
    assert.match(body, /<Gather/);
    assert.doesNotMatch(body, /<Hangup/);
  } finally {
    await srv.stop();
  }
});

test("P3-G4b: drei aufeinanderfolgende leere Gathers -> drei verschiedene Antworten, dritte legt auf", async () => {
  const id = "call_p3g4b";
  const srv = await startAktiverAnruf({ id, transcript: SCHWEIGENDER_ANRUFER });
  try {
    const turnTexts = [];
    for (let zaehler = 0; zaehler < LEERE_ZUEGE_BIS_AUFLEGEN; zaehler++) {
      turnTexts.push((await zug(srv, id, "")).body);
    }
    const [erster, zweiter, dritter] = turnTexts;

    assert.match(erster, ERSTE_NACHFRAGE);
    assert.match(erster, /<Gather/);
    assert.doesNotMatch(erster, /<Hangup/);

    assert.match(zweiter, ZWEITE_NACHFRAGE);
    assert.match(zweiter, /<Gather/);
    assert.doesNotMatch(zweiter, /<Hangup/);

    assert.match(dritter, STILLE_ABSCHIED);
    assert.match(dritter, /<Hangup/);
    assert.doesNotMatch(dritter, /<Gather/);

    assert.notEqual(erster, zweiter);
    assert.notEqual(zweiter, dritter);
    assert.notEqual(erster, dritter);
  } finally {
    await srv.stop();
  }
});

test("P3-G4c: eine verstandene Aeusserung setzt die Staffel zurueck (konsekutiv, nicht kumulativ)", async () => {
  const mock = await startModellAttrappe(textMessage("Alles klar, einen Moment."));
  const id = "call_p3g4c";
  const srv = await startAktiverAnruf({
    id,
    env: { ANTHROPIC_BASE_URL: mock.url },
    transcript: SCHWEIGENDER_ANRUFER,
  });
  try {
    assert.match((await zug(srv, id, "")).body, ERSTE_NACHFRAGE);

    const verstanden = await zug(srv, id, "Ja bitte");
    assert.equal(verstanden.status, HTTP_OK);
    assert.doesNotMatch(verstanden.body, /<Hangup/);

    const dritter = (await zug(srv, id, "")).body;
    assert.match(dritter, ERSTE_NACHFRAGE);
    assert.doesNotMatch(dritter, /<Hangup/);

    const vierter = (await zug(srv, id, "")).body;
    assert.match(vierter, ZWEITE_NACHFRAGE);
    assert.doesNotMatch(vierter, /<Hangup/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("G3/G26 Runde 2: Rausch-Turn dann echte Dauerstille - der R4-Deadlock-Schutz bleibt ueber /voice/turn erreichbar", async () => {
  const mock = await startModellAttrappe(endCallMessage("Ich lege jetzt auf."));
  const id = "call_g326_shortcut";
  const srv = await startAktiverAnruf({
    id,
    env: { ANTHROPIC_BASE_URL: mock.url, MAX_EMPTY_TURNS: "2" },
  });
  try {
    const openRes = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest" }),
    });
    assert.equal(openRes.status, HTTP_OK);

    const noiseBody = (await zug(srv, id, ".")).body;
    assert.match(noiseBody, /<Gather/, `Rausch-Turn muss weiterlaufen: ${noiseBody}`);
    assert.doesNotMatch(
      noiseBody,
      /<Hangup/,
      `Rausch darf end_call nicht freigeben (R2): ${noiseBody}`,
    );

    const silentBody = (await zug(srv, id, "")).body;
    assert.match(
      silentBody,
      /<Hangup/,
      `nach maxEmptyTurns muss der Guard trotz Rausch-Historie auflegen: ${silentBody}`,
    );

    const call = srv.readStore().calls.find((gespeichert) => gespeichert.id === id);
    const callerLines = call.transcript.filter((zeile) => zeile.role === "caller");
    assert.equal(callerLines.length, 1);
    assert.equal(callerLines[0].text, ".");
  } finally {
    await srv.stop();
    await mock.close();
  }
});
