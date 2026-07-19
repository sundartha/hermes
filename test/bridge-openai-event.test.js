// A3 / Phase 1 — Charakterisierungs-Test fuer den HEUTIGEN inline OpenAI-Realtime-
// Event-Handler in src/bridge.js (connectOpenAI -> openaiWs.on("message", ...)).
//
// Zweck: ein Sicherheitsnetz, das die exakte Frame-Ausgabe des Handlers festnagelt,
// BEVOR er (in Folgephasen) als handleOpenAiEvent(ev, ctx) herausgezogen wird. Der
// Test ruft KEINEN Produktionscode-Umbau auf - er pinnt nur das Ist-Verhalten. Er
// muss vor UND nach dem spaeteren Refactoring unveraendert gruen sein.
//
// Harness (Integrations-Charakterisierung, Strategie-Dok a3-bridge-openai-event.md
// Abschnitt 5.2): die reale attachMediaBridge-Strecke laeuft offline ueber einen
// lokalen http.Server + einen echten ws-Provider-Client. NUR die auswaerts gehende
// OpenAI-Verbindung (new WebSocket("wss://api.openai.com/...")) wird ueber einen
// Loader-Hook (module.register) durch einen steuerbaren In-Memory-Fake ersetzt
// (test/helpers/ws-openai-shim.mjs) - so lassen sich onmessage/onopen/onclose/
// onerror von aussen ausloesen und readyState (fuer den canSend-Guard) frei setzen,
// OHNE Produktionscode anzufassen und OHNE Netz/.env/echtes OpenAI.
//
// Aufgezeichnet wird EINE geordnete Liste aller .send()-Aufrufe als [ziel, nutzlast]
// ("openai" = Fake-Socket, "provider" = serverseitiger Bridge-Socket). Da der
// Handler synchron laeuft und beide send-Wrapper synchron aufzeichnen, pinnt
// assert.deepStrictEqual die exakte Reihenfolge ueber beide Sockets hinweg.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { register, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { BASE_ENV, tempDataDir } from "./helpers.js";
import { twilioMedia } from "../src/telephony/adapters/twilio/media.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// ---- Umgebung deterministisch fixieren, BEVOR config.js (via bridge.js) laedt ----
// BASE_ENV ist der gleiche neutrale Satz wie bei den Spawn-Tests (keine .env-Leaks).
// DATA_DIR -> frisches Temp (kein Zugriff auf echtes data/store.json). __REAL_WS_URL
// haelt die echte ws-Implementierung als file:-URL fuer das Shim bereit (vor
// register() aufgeloest, damit der "ws"-Redirect den Pfad nicht selbst umlenkt).
const require = createRequire(import.meta.url);
process.env.__REAL_WS_URL = pathToFileURL(require.resolve("ws")).href;
Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  VOICE_ENGINE: "realtime",
  OPENAI_API_KEY: "test-openai-key",
});

// Loader-Hook: NUR den Specifier "ws" auf das Shim umlenken. Jeder andere Import
// (auch der file:-Import der echten ws im Shim) laeuft unveraendert.
const shimUrl = new URL("./helpers/ws-openai-shim.mjs", import.meta.url).href;
const loaderSrc = `
export async function resolve(specifier, context, next) {
  if (specifier === "ws") return { url: ${JSON.stringify(shimUrl)}, shortCircuit: true };
  return next(specifier, context);
}
`;
register("data:text/javascript," + encodeURIComponent(loaderSrc), import.meta.url);

// Erst NACH register() + gesetztem Env laden (sonst greift der Redirect nicht bzw.
// config.js wuerde mit falschem Env eingefroren).
const { attachMediaBridge } = await import("../src/bridge.js");
const store = await import("../src/store.js");
const { disclosureSentence, END_CALL_WAIT_INSTRUCTION } = await import("../src/claude.js");
const {
  openAiSockets,
  resetOpenAiSockets,
  default: WebSocket,
} = await import("./helpers/ws-openai-shim.mjs");

const STREAM_REF = "MZ1"; // Twilio streamSid aus dem start-Frame == bridge-interner streamRef
const TAKE_MESSAGE_RESULT = "Nachricht ist notiert."; // execTool(take_message) heute

// Ein OpenAI-Event als ws-Frame (Buffer, wie es die echte ws emittiert) in den
// Handler einspeisen. Der Handler laeuft synchron -> Aufzeichnung ist danach fertig.
function feed(fake, ev) {
  fake.emit("message", Buffer.from(JSON.stringify(ev)));
}

// console.log/error temporaer mitschneiden (hangup/Fehler spiegeln sich nur ins Log).
function captureConsole() {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => errors.push(a.join(" "));
  return {
    logs,
    errors,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

async function waitForFake(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (openAiSockets.length === 0) {
    if (Date.now() > deadline) throw new Error("connectOpenAI() hat keinen OpenAI-Socket erzeugt");
    await new Promise((r) => setTimeout(r, 5));
  }
  return openAiSockets[openAiSockets.length - 1];
}

// Faehrt die reale Bridge-Strecke bis kurz vor das erste OpenAI-Event hoch:
// http.Server + attachMediaBridge + echter Provider-Client + start-Frame ->
// connectOpenAI() -> Fake-OpenAI-Socket. Liefert die geordnete sends-Liste, den
// Fake (zum Treiben der Events) und cleanup().
async function setupCall(callOverrides = {}, onCallEnded = () => {}) {
  resetOpenAiSockets();
  const httpServer = http.createServer();
  await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
  const port = httpServer.address().port;

  const wss = attachMediaBridge(httpServer, onCallEnded);

  const sends = [];
  let providerWs = null;
  // Zweiter connection-Listener, BEWUSST nach attachMediaBridge registriert
  // (Reihenfolge ist load-bearing: EventEmitter ruft Listener synchron in
  // Registrierungsreihenfolge -> der Bridge-Listener richtet providerWs.on("message")
  // ein, danach wrappt dieser hier denselben Socket-.send() fuer die synchrone
  // Aufzeichnung - rechtzeitig vor dem ersten Frame).
  wss.on("connection", (sock) => {
    providerWs = sock;
    const origSend = sock.send.bind(sock);
    sock.send = (data) => {
      sends.push(["provider", data]);
      return origSend(data);
    };
  });

  const call = store.createCall({
    direction: "outbound",
    from: "+15005550006",
    to: "+4915112345678",
    goal: "Testziel",
    maxDurationS: 60,
    tenantId: BOOTSTRAP_TENANT_ID,
    ...callOverrides,
  });

  const client = new WebSocket(`ws://127.0.0.1:${port}/media`);
  await new Promise((resolve, reject) => {
    client.on("open", resolve);
    client.on("error", reject);
  });

  // start-Frame BEWUSST OHNE callSid -> call.twilioSid bleibt null -> hangup() ruft
  // NIE den echten Twilio-Adapter (kein Netz). streamSid -> streamRef.
  client.send(
    JSON.stringify({
      event: "start",
      start: {
        streamSid: STREAM_REF,
        customParameters: { call_id: call.id, stream_token: call.streamToken },
      },
    }),
  );

  const fake = await waitForFake();
  const origFakeSend = fake.send.bind(fake);
  fake.send = (data) => {
    sends.push(["openai", data]);
    return origFakeSend(data);
  };
  sends.length = 0; // Verbindungsaufbau-Rauschen verwerfen

  const cleanup = async () => {
    const closed = providerWs ? new Promise((r) => providerWs.on("close", r)) : Promise.resolve();
    try {
      client.close();
    } catch {}
    await closed; // -> finalize() raeumt endTimer/hangupTimer auf
    await new Promise((r) => httpServer.close(r));
  };

  return { call, fake, sends, cleanup, providerWs, client, httpServer };
}

// ---- connectOpenAI open-Handler (Kontext, NICHT Ziel des Refactorings) ----

test("open-Handshake: session.update + response.create mit Offenlegungssatz (Outbound)", async () => {
  const { call, fake, sends, cleanup } = await setupCall();
  try {
    fake.emit("open");
    assert.equal(sends.length, 2);

    const [side0, raw0] = sends[0];
    const [side1, raw1] = sends[1];
    assert.equal(side0, "openai");
    assert.equal(side1, "openai");

    const sessionUpdate = JSON.parse(raw0);
    assert.equal(sessionUpdate.type, "session.update");
    assert.deepEqual(sessionUpdate.session.modalities, ["text", "audio"]);
    assert.equal(sessionUpdate.session.input_audio_format, "g711_ulaw");
    assert.equal(sessionUpdate.session.output_audio_format, "g711_ulaw");
    assert.equal(sessionUpdate.session.voice, "alloy");
    assert.ok(Array.isArray(sessionUpdate.session.tools));
    // P5: der Barge-in-Halbsatz ist aus den Realtime-instructions gestrichen (Barge-in
    // laeuft ueber server_vad, nicht per Modellanweisung) - der Prosodie-Hinweis bleibt.
    assert.ok(!sessionUpdate.session.instructions.includes("Pausen"));
    assert.ok(sessionUpdate.session.instructions.includes("natuerlich, zuegig, kurze Saetze"));

    const responseCreate = JSON.parse(raw1);
    assert.equal(responseCreate.type, "response.create");
    // Absolute Regel 3: Offenlegungssatz fest verdrahtet als erster Outbound-Satz.
    assert.ok(responseCreate.response.instructions.includes(disclosureSentence(call)));
  } finally {
    await cleanup();
  }
});

test("open-Handshake: Inbound-Opener ist die Begruessung, kein Offenlegungssatz", async () => {
  const { call, fake, sends, cleanup } = await setupCall({ direction: "inbound" });
  try {
    fake.emit("open");
    assert.equal(sends.length, 2);
    const responseCreate = JSON.parse(sends[1][1]);
    assert.equal(responseCreate.type, "response.create");
    // Inbound: fester Begruessungs-Opener, NICHT der Outbound-Offenlegungssatz.
    assert.equal(
      responseCreate.response.instructions,
      "Der Anrufer ist in der Leitung. Begruesse ihn jetzt entsprechend deiner Anweisungen.",
    );
    assert.ok(!responseCreate.response.instructions.includes(disclosureSentence(call)));
  } finally {
    await cleanup();
  }
});

// ---- Phase 5: Realtime-Engine-Sprache (Voice + Whisper-Locale + Opener) ----

test("DE-Realtime byte-identisch: keine Whisper-language (Auto-Detect, Bestand)", async () => {
  // DE-Pfad: whisperLocale=null im Bundle -> kein language-Feld in der Session
  // (Auto-Detect, exakt wie der Bestand). Voice bleibt config-Default ("alloy").
  const { fake, sends, cleanup } = await setupCall({ language: "de" });
  try {
    fake.emit("open");
    const sessionUpdate = JSON.parse(sends[0][1]);
    assert.deepEqual(sessionUpdate.session.input_audio_transcription, { model: "whisper-1" });
    assert.equal(sessionUpdate.session.voice, "alloy");
  } finally {
    await cleanup();
  }
});

test("FR-Realtime: kuratierte Voice + Whisper-fr + FR-Opener mit FR-Offenlegung (Outbound)", async () => {
  const { call, fake, sends, cleanup } = await setupCall({ language: "fr", direction: "outbound" });
  try {
    fake.emit("open");
    const sessionUpdate = JSON.parse(sends[0][1]);
    assert.equal(sessionUpdate.session.voice, "shimmer");
    assert.equal(sessionUpdate.session.input_audio_transcription.language, "fr");
    const responseCreate = JSON.parse(sends[1][1]);
    // Absolute Regel 2: kuratierte FR-Offenlegung fest verdrahtet im Opener.
    assert.ok(responseCreate.response.instructions.includes(disclosureSentence(call)));
    assert.ok(responseCreate.response.instructions.includes("Commence la conversation MAINTENANT"));
  } finally {
    await cleanup();
  }
});

test("EN-Realtime: kuratierte Voice + Whisper-en + EN-Inbound-Opener", async () => {
  const { call, fake, sends, cleanup } = await setupCall({ language: "en", direction: "inbound" });
  try {
    fake.emit("open");
    const sessionUpdate = JSON.parse(sends[0][1]);
    assert.equal(sessionUpdate.session.voice, "alloy");
    assert.equal(sessionUpdate.session.input_audio_transcription.language, "en");
    const responseCreate = JSON.parse(sends[1][1]);
    assert.equal(
      responseCreate.response.instructions,
      "The caller is on the line. Greet them now according to your instructions.",
    );
    // Inbound: kein Offenlegungssatz im Opener.
    assert.ok(!responseCreate.response.instructions.includes(disclosureSentence(call)));
  } finally {
    await cleanup();
  }
});

// ---- Audio KI -> Telefonie (beide Schema-Varianten) ----

test("Audio-Delta -> providerWs.send(buildMediaFrame), beta + GA", async () => {
  const { fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, { type: "response.audio.delta", delta: "AAA" });
    feed(fake, { type: "response.output_audio.delta", delta: "BBB" });
    assert.deepStrictEqual(sends, [
      [
        "provider",
        JSON.stringify(twilioMedia.buildMediaFrame({ payload: "AAA", streamRef: STREAM_REF })),
      ],
      [
        "provider",
        JSON.stringify(twilioMedia.buildMediaFrame({ payload: "BBB", streamRef: STREAM_REF })),
      ],
    ]);
  } finally {
    await cleanup();
  }
});

test("Audio-Delta ohne delta-Feld -> kein Send", async () => {
  const { fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, { type: "response.audio.delta" });
    assert.deepStrictEqual(sends, []);
  } finally {
    await cleanup();
  }
});

// ---- HEIKLE STELLE 1: Barge-in ----

test("Barge-in: response.created dann speech_started -> cancel (openai) VOR clearPlayback (provider)", async () => {
  const { fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, { type: "response.created" }); // activeResponse = true
    sends.length = 0;
    feed(fake, { type: "input_audio_buffer.speech_started" });
    // Absolute Regel 1: response.cancel ZUERST, dann clearPlayback.
    assert.deepStrictEqual(sends, [
      ["openai", JSON.stringify({ type: "response.cancel" })],
      ["provider", JSON.stringify(twilioMedia.clearPlayback({ streamRef: STREAM_REF }))],
    ]);
  } finally {
    await cleanup();
  }
});

test("Barge-in ohne aktive Response -> nur clearPlayback, kein cancel", async () => {
  const { fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, { type: "input_audio_buffer.speech_started" });
    assert.deepStrictEqual(sends, [
      ["provider", JSON.stringify(twilioMedia.clearPlayback({ streamRef: STREAM_REF }))],
    ]);
  } finally {
    await cleanup();
  }
});

test("Barge-in bei geschlossenem OpenAI-Socket -> kein cancel trotz aktiver Response", async () => {
  const { fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, { type: "response.created" });
    fake.readyState = WebSocket.CLOSED; // canSend(openaiWs) === false
    sends.length = 0;
    feed(fake, { type: "input_audio_buffer.speech_started" });
    // canSend-Guard greift: kein cancel, aber clearPlayback (nur an streamRef gebunden).
    assert.deepStrictEqual(sends, [
      ["provider", JSON.stringify(twilioMedia.clearPlayback({ streamRef: STREAM_REF }))],
    ]);
  } finally {
    await cleanup();
  }
});

// ---- Transkripte ----

test("Transkript Anrufer: input_audio_transcription.completed -> addTranscript(caller, getrimmt)", async () => {
  const { call, fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "  hallo  ",
    });
    assert.deepStrictEqual(sends, []);
    const t = store.getCall(call.id).transcript;
    assert.deepEqual(
      t.map((x) => ({ role: x.role, text: x.text })),
      [{ role: "caller", text: "hallo" }],
    );
  } finally {
    await cleanup();
  }
});

test("Transkript Anrufer: nur Whitespace -> kein addTranscript", async () => {
  const { call, fake, cleanup } = await setupCall();
  try {
    feed(fake, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "   ",
    });
    assert.equal(store.getCall(call.id).transcript.length, 0);
  } finally {
    await cleanup();
  }
});

test("Transkript Agent: response.audio_transcript.done + output-Variante -> addTranscript(agent, geshaped)", async () => {
  const { call, fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, { type: "response.audio_transcript.done", transcript: "Guten Tag" });
    feed(fake, { type: "response.output_audio_transcript.done", transcript: "Auf Wiederhoeren" });
    assert.deepStrictEqual(sends, []);
    const t = store.getCall(call.id).transcript;
    // P7 (C7): I8-Paritaet - der Agent-Text laeuft jetzt durch denselben shapeForSpeech
    // wie die Budget-Engine (haengt ein Satzende an, wenn keins vorhanden ist).
    assert.deepEqual(
      t.map((x) => ({ role: x.role, text: x.text })),
      [
        { role: "agent", text: "Guten Tag." },
        { role: "agent", text: "Auf Wiederhoeren." },
      ],
    );
  } finally {
    await cleanup();
  }
});

// ---- Tool-Aufrufe (response.done) ----

test("Tool-Call: response.done(take_message) -> execTool + function_call_output + response.create", async () => {
  const { call, fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, {
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            name: "take_message",
            arguments: JSON.stringify({ message: "Rueckruf erbeten" }),
            call_id: "c1",
          },
        ],
      },
    });
    assert.deepStrictEqual(sends, [
      [
        "openai",
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: "c1", output: TAKE_MESSAGE_RESULT },
        }),
      ],
      ["openai", JSON.stringify({ type: "response.create" })],
    ]);
    // Seiteneffekt: execTool(take_message) hat ein Action Item angelegt.
    assert.equal(store.getCall(call.id).actionItemIds.length, 1);
  } finally {
    await cleanup();
  }
});

test("Tool-Call bei geschlossenem Socket: execTool laeuft, aber KEINE Sends", async () => {
  const { call, fake, sends, cleanup } = await setupCall();
  try {
    fake.readyState = WebSocket.CLOSED; // canSend(openaiWs) === false
    feed(fake, {
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            name: "take_message",
            arguments: JSON.stringify({ message: "x" }),
            call_id: "c1",
          },
        ],
      },
    });
    // Absolute Regel 5: execTool laeuft IMMER, nur die Sends stehen unter canSend.
    assert.deepStrictEqual(sends, []);
    assert.equal(store.getCall(call.id).actionItemIds.length, 1);
  } finally {
    await cleanup();
  }
});

test("Tool-Call mit kaputten arguments -> args={}, kein Throw, Sends laufen", async () => {
  const { fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, {
      type: "response.done",
      response: {
        output: [
          { type: "function_call", name: "take_message", arguments: "{kaputt", call_id: "c2" },
        ],
      },
    });
    assert.deepStrictEqual(sends, [
      [
        "openai",
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: "c2", output: TAKE_MESSAGE_RESULT },
        }),
      ],
      ["openai", JSON.stringify({ type: "response.create" })],
    ]);
  } finally {
    await cleanup();
  }
});

// ---- HEIKLE STELLE 2: Call-Ende (end_call -> 2500ms Puffer) ----

test("end_call: response.done(end_call) plant hangup nach 2500ms, kein execTool/Send", async (t) => {
  const { call, fake, sends, cleanup } = await setupCall();
  const cap = captureConsole();
  // Nur setTimeout mocken (clearTimeout bleibt echt: der reale Max-Dauer-endTimer
  // wurde vor dem Mock gesetzt und muss in finalize() echt geleert werden koennen).
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    // P7 (C7): Guard-Paritaet zur Budget-Engine (shouldSuppressEndCall) unterdrueckt
    // end_call bei Outbound VOR der ersten substanziellen Anrufer-Antwort - dieser Test
    // prueft den Hangup-Puffer-Mechanismus selbst, nicht den Guard (dafuer siehe
    // bridge-event-unit.test.js), darum erst eine substanzielle Antwort einspeisen.
    feed(fake, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Ja, das passt mir gut",
    });
    sends.length = 0;
    feed(fake, {
      type: "response.done",
      response: {
        output: [{ type: "function_call", name: "end_call", arguments: "{}", call_id: "e1" }],
      },
    });
    assert.deepStrictEqual(sends, []); // end_call: kein function_call_output, kein response.create
    assert.equal(store.getCall(call.id).actionItemIds.length, 0); // kein execTool fuer end_call
    assert.ok(
      !cap.logs.some((l) => l.includes("hangup:")),
      "hangup darf noch nicht gefeuert haben",
    );

    t.mock.timers.tick(2500);
    assert.ok(
      cap.logs.some((l) => l.includes("hangup: end_call von KI")),
      "hangup nach 2500ms erwartet",
    );
  } finally {
    t.mock.timers.reset(); // echte Timer fuer cleanup wiederherstellen
    cap.restore();
    await cleanup();
  }
});

test("response.done setzt activeResponse=false (danach kein Barge-in-cancel)", async () => {
  const { fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, { type: "response.created" }); // activeResponse = true
    feed(fake, { type: "response.done", response: { output: [] } }); // -> activeResponse = false
    sends.length = 0;
    feed(fake, { type: "input_audio_buffer.speech_started" });
    assert.deepStrictEqual(sends, [
      ["provider", JSON.stringify(twilioMedia.clearPlayback({ streamRef: STREAM_REF }))],
    ]);
  } finally {
    await cleanup();
  }
});

// ---- P7 (C7) Pre-Mortem: response.create-Roundtrip im unterdrueckten end_call-Zweig
// gegen den Barge-in-Guard (HEIKLE STELLE 1) ----
// Sorge aus PLAN-FRAGILITY-REMEDIATION.md P7: der zusaetzliche conversation.item.create +
// response.create in sendFunctionOutput (unterdrueckter end_call) koennte activeResponse
// in einen falschen Zustand bringen und den Barge-in-Guard aushebeln. End-zu-Ende ueber
// dieselbe echte Bridge-Strecke wie die Barge-in-Tests oben (echter HTTP-Server, echter
// Provider-Client, nur der auswaertige OpenAI-Socket ist das Shim): nach dem unterdrueckten
// end_call setzt das folgende response.created (Beginn der Wait-Instruktion-Antwort)
// activeResponse korrekt neu, und ein Barge-in waehrend dieser Antwort loest response.cancel
// aus wie bei jeder anderen Antwort - keine Sonderbehandlung, keine Kollision, kein
// haengengebliebener Zustand.
test("unterdrueckter end_call: response.create-Roundtrip + folgender Barge-in kollidieren nicht", async () => {
  const { fake, sends, cleanup } = await setupCall(); // outbound, kein Transkript -> unterdrueckt
  try {
    feed(fake, {
      type: "response.done",
      response: {
        output: [{ type: "function_call", name: "end_call", arguments: "{}", call_id: "e1" }],
      },
    });
    // unterdrueckt: Wait-Instruktion als function_call_output + response.create (kein
    // scheduleHangup, siehe bridge-event-unit.test.js fuer den Guard selbst).
    assert.deepStrictEqual(sends, [
      [
        "openai",
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: "e1", output: END_CALL_WAIT_INSTRUCTION },
        }),
      ],
      ["openai", JSON.stringify({ type: "response.create" })],
    ]);
    sends.length = 0;

    // OpenAI beginnt, die Wait-Instruktion auszuspielen -> activeResponse wird neu gesetzt.
    feed(fake, { type: "response.created" });
    sends.length = 0;

    // Der Angerufene faellt der KI waehrend der Wait-Instruktion ins Wort (Barge-in).
    feed(fake, { type: "input_audio_buffer.speech_started" });
    assert.deepStrictEqual(sends, [
      ["openai", JSON.stringify({ type: "response.cancel" })],
      ["provider", JSON.stringify(twilioMedia.clearPlayback({ streamRef: STREAM_REF }))],
    ]);
  } finally {
    await cleanup();
  }
});

// ---- error-Event, ignorierte/unbekannte Events, Crash-Guards ----

test("OpenAI-Event 'error' -> nur console.error, kein Send, kein hangup", async () => {
  const { fake, sends, cleanup } = await setupCall();
  const cap = captureConsole();
  try {
    feed(fake, { type: "error", error: { message: "boom" } });
    assert.deepStrictEqual(sends, []);
    assert.ok(cap.errors.some((e) => e.includes("OpenAI error: boom")));
    assert.ok(!cap.logs.some((l) => l.includes("hangup:")), "ein error-Event darf NICHT auflegen");
  } finally {
    cap.restore();
    await cleanup();
  }
});

test("session.updated und unbekannte Events -> No-Op", async () => {
  const { fake, sends, cleanup } = await setupCall();
  try {
    feed(fake, { type: "session.updated", session: {} });
    feed(fake, { type: "voellig.unbekannt" });
    assert.deepStrictEqual(sends, []);
  } finally {
    await cleanup();
  }
});

test("Crash-Guard: werfendes Event wird vom aeusseren try/catch gefangen (kein Re-Throw)", async () => {
  const { fake, sends, cleanup } = await setupCall();
  const cap = captureConsole();
  try {
    // transcript ist eine Zahl -> ev.transcript?.trim() wirft TypeError im switch-Body.
    // Wenn der aeussere Guard intakt ist, kommt der Throw NICHT aus feed() heraus.
    assert.doesNotThrow(() =>
      feed(fake, {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: 12345,
      }),
    );
    assert.deepStrictEqual(sends, []);
    assert.ok(cap.errors.some((e) => e.includes("openai message handler")));
  } finally {
    cap.restore();
    await cleanup();
  }
});

test("Innerer JSON-Guard: Nicht-JSON-Frame wird still verworfen", async () => {
  const { fake, sends, cleanup } = await setupCall();
  const cap = captureConsole();
  try {
    assert.doesNotThrow(() => fake.emit("message", Buffer.from("kein json{")));
    assert.deepStrictEqual(sends, []);
    // Innerer catch macht ein stilles return - KEIN handler-Fehlerlog.
    assert.ok(!cap.errors.some((e) => e.includes("openai message handler")));
  } finally {
    cap.restore();
    await cleanup();
  }
});

// ---- Socket-Lebenszyklus (close/error -> hangup) ----

test("OpenAI-Socket close -> hangup('openai-verbindung-weg')", async () => {
  const { fake, cleanup } = await setupCall();
  const cap = captureConsole();
  try {
    fake.close();
    assert.ok(cap.logs.some((l) => l.includes("OpenAI WS zu")));
    assert.ok(cap.logs.some((l) => l.includes("hangup: openai-verbindung-weg")));
  } finally {
    cap.restore();
    await cleanup();
  }
});

test("OpenAI-Socket error -> hangup('openai-error')", async () => {
  const { fake, cleanup } = await setupCall();
  const cap = captureConsole();
  try {
    fake.emit("error", new Error("conn weg"));
    assert.ok(cap.errors.some((e) => e.includes("OpenAI WS: conn weg")));
    assert.ok(cap.logs.some((l) => l.includes("hangup: openai-error")));
  } finally {
    cap.restore();
    await cleanup();
  }
});

// ---- PA-1: finalize()-Idempotenz (Wiring-Regressionsgurt fuer PA-16) ----

test("finalize-Idempotenz: STOP-Frame DANN providerWs-Close rufen onCallEnded GENAU EINMAL", async () => {
  const onCallEnded = mock.fn();
  const { call, providerWs, client, httpServer } = await setupCall({}, onCallEnded);
  try {
    // Echter Doppel-Trigger an den zwei realen finalize-Einstiegen:
    // Trigger 1 - STOP-Media-Frame (Gegenseite legt auf) -> finalize("completed").
    providerWs.emit("message", Buffer.from(JSON.stringify({ event: "stop" })));
    // Trigger 2 - providerWs-Close (der Socket-Close nach dem Hangup) -> zweiter finalize-
    // Einstieg. Der closed-Guard MUSS ihn verschlucken.
    providerWs.emit("close");

    // Faengt Doppelaufruf (Guard entfernt -> 2) UND verlorenen Callback (onCallEnded weg -> 0).
    assert.equal(onCallEnded.mock.callCount(), 1);
    const rec = onCallEnded.mock.calls[0].arguments[0];
    assert.equal(rec.id, call.id);
    assert.equal(rec.status, "completed"); // STOP + nicht cancelled -> completed
    assert.deepEqual(rec, store.getCall(call.id)); // finalize liest den Record frisch aus dem Store
  } finally {
    try {
      client.close();
    } catch {}
    await new Promise((r) => httpServer.close(r));
  }
});
