// A3 / Phase 3 — Direkte Unit-Tests fuer den extrahierten handleOpenAiEvent(ev, ctx)
// aus src/bridge.js (A3-P2). KEIN attachMediaBridge, KEIN WebSocketServer, KEIN
// upgrade-Handshake, KEIN Netz, KEIN echtes OpenAI: der Handler wird mit einem
// handgebauten Fake-ctx DIREKT aufgerufen. Schliesst die AC1-Luecke aus
// bridge-hardening.test.js ("im gespawnten Server nicht injizierbar") — Strategie
// docs/strategy/a3-bridge-openai-event.md § Phase 3 / § 5.3 Option (b).
//
// FOKUS dieser Datei (TRIVIAL-Scope, am Code verifiziert): die Guard-/No-op-Pfade des
// Handlers — session.updated, unbekannter Event-Typ, typenloses Event sowie das echte
// Verhalten der Parse-/Crash-Guards an der Naht. Die positiven Golden-Outputs (Audio-
// Delta, Barge-in, Transkripte, Tool-Loop, end_call) sind bereits in
// bridge-openai-event.test.js (Phase 1) festgenagelt und werden hier NICHT dupliziert.
//
// WICHTIG — Signatur & Guard-Platzierung (verifiziert an src/bridge.js, A3-P2):
//   * Der Handler hat die Signatur handleOpenAiEvent(ev, ctx) und bekommt ein BEREITS
//     GEPARSTES Event `ev` (kein Buffer). Der JSON-Parse-Guard
//     (`try { ev = JSON.parse(buf) } catch { return }`) liegt im duennen Listener
//     openaiWs.on("message"), NICHT im Handler.
//   * Auch der aeussere Crash-Guard (`try { handleOpenAiEvent(ev, ctx) } catch { log }`)
//     liegt im Listener, NICHT im Handler (Strategie § 3.3: Listener-Platzierung ist
//     die verhaltens-erhaltende Variante). handleOpenAiEvent kapselt also KEINEN
//     eigenen aeusseren Crash-Guard — ein Throw aus store/Event-Verarbeitung
//     propagiert aus dem Handler heraus (Test "Crash-Guard liegt im Listener" unten).
//   Das System-Verhalten (Non-JSON-Buffer wird still verworfen, Throw wird geloggt
//   statt zu crashen) deckt bridge-hardening.test.js auf System-Ebene ab; diese Datei
//   charakterisiert das Handler-Verhalten an genau dieser Naht.
import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { handleOpenAiEvent } from "../src/bridge.js";

// Fake-Socket: zeichnet jeden .send(...)-Aufruf als Nutzlast-String auf; readyState
// steuert canSend(ws) (=== WebSocket.OPEN). Default OPEN, damit ein versehentlicher
// Send sichtbar wird, statt vom canSend-Guard stillschweigend verschluckt zu werden.
function fakeSocket(readyState = WebSocket.OPEN) {
  const sent = [];
  return { readyState, send: (s) => sent.push(s), sent };
}

// Baut ein vollstaendiges Fake-ctx, wie es connectOpenAI() zur Laufzeit zusammenbaut
// (src/bridge.js): zwei Spy-Sockets, alle veraenderlichen Slots in `state`, Spies auf
// store.addTranscript/hangup/scheduleHangup/finalize/log und ein Minimal-Fake fuer den
// media-Adapter (offline, ohne echten Port-4-Adapter). Jeder Test baut sein eigenes ctx
// (F.I.R.S.T. Independent) — kein geteilter Modul-State zwischen Tests.
function makeCtx(overrides = {}) {
  const providerWs = overrides.providerWs ?? fakeSocket();
  const openaiWs = overrides.openaiWs ?? fakeSocket();
  const calls = { addTranscript: [], hangup: [], scheduleHangup: [], finalize: [] };
  const ctx = {
    call: { id: "call-1", tenantId: "t1", direction: "inbound" },
    streamRef: "stream-1",
    openaiWs,
    providerWs,
    state: { activeResponse: false, hangupTimer: null },
    log: () => {},
    hangup: (reason) => calls.hangup.push(reason),
    scheduleHangup: (reason) => calls.scheduleHangup.push(reason),
    finalize: (status) => calls.finalize.push(status),
    store: { addTranscript: (...a) => calls.addTranscript.push(a) },
    media: {
      buildMediaFrame: (o) => ({ kind: "media", ...o }),
      clearPlayback: (o) => ({ kind: "clear", ...o }),
    },
    ...overrides,
  };
  ctx.calls = calls; // Bequemer Zugriff in den Assertions
  return ctx;
}

// Assert: dieses Event hat KEINEN Seiteneffekt ausgeloest (echtes No-op).
function assertNoSideEffects(ctx) {
  assert.equal(ctx.providerWs.sent.length, 0, "kein providerWs.send erwartet");
  assert.equal(ctx.openaiWs.sent.length, 0, "kein openaiWs.send erwartet");
  assert.equal(ctx.calls.addTranscript.length, 0, "kein store.addTranscript erwartet");
  assert.equal(ctx.calls.hangup.length, 0, "kein hangup erwartet");
  assert.equal(ctx.calls.scheduleHangup.length, 0, "kein scheduleHangup erwartet");
  assert.equal(ctx.calls.finalize.length, 0, "kein finalize erwartet");
}

// ---- session.updated: bekannter, aber unbehandelter Event-Typ (kein switch-Case) ----
test("session.updated ist ein No-op (kein Case, kein Seiteneffekt, kein Throw)", () => {
  const ctx = makeCtx();
  assert.doesNotThrow(() => handleOpenAiEvent({ type: "session.updated" }, ctx));
  assertNoSideEffects(ctx);
  // State bleibt unberuehrt: weder response.created noch response.done lief.
  assert.equal(ctx.state.activeResponse, false);
  assert.equal(ctx.state.hangupTimer, null);
});

// ---- unbekannter Event-Typ: faellt durch den switch (default-loses No-op) ----
test("unbekannter Event-Typ ist ein No-op", () => {
  const ctx = makeCtx();
  assert.doesNotThrow(() => handleOpenAiEvent({ type: "irgendwas.unbekanntes" }, ctx));
  assertNoSideEffects(ctx);
});

// ---- Parse-Guard-Analogon (Handler-Ebene): typenloses Objekt ----
// Der echte JSON-Parse-Guard liegt im Listener; der Handler bekommt ein bereits
// geparstes Objekt. Ein Objekt ohne `type` ergibt switch(undefined) -> kein Case ->
// No-op, kein Throw. So degradiert der Handler robust auf eine entartete Parse-Ausgabe.
test("typenloses Event ({}) ist ein No-op (Parse-Guard-Analogon)", () => {
  const ctx = makeCtx();
  assert.doesNotThrow(() => handleOpenAiEvent({}, ctx));
  assertNoSideEffects(ctx);
});

test("Event mit leerem type ('') ist ein No-op", () => {
  const ctx = makeCtx();
  assert.doesNotThrow(() => handleOpenAiEvent({ type: "" }, ctx));
  assertNoSideEffects(ctx);
});

// ---- entartetes, aber getyptes Event: getroffener Case, dessen Innen-Guard greift ----
// response.audio.delta wird zwar erkannt, der Send steht aber unter `if (streamRef &&
// ev.delta)`. Fehlt delta oder streamRef, darf KEIN providerWs.send passieren.
test("response.audio.delta ohne delta oder ohne streamRef sendet nichts", () => {
  const ohneDelta = makeCtx();
  handleOpenAiEvent({ type: "response.audio.delta" }, ohneDelta); // ev.delta fehlt
  assertNoSideEffects(ohneDelta);

  const ohneStreamRef = makeCtx({ streamRef: null });
  handleOpenAiEvent({ type: "response.audio.delta", delta: "AAA" }, ohneStreamRef);
  assertNoSideEffects(ohneStreamRef);
});

// ---- Crash-Guard: liegt im Listener, NICHT im Handler ----
// P2 platziert den aeusseren try/catch (+ console.error) im Listener openaiWs.on(
// "message"), nicht in handleOpenAiEvent (Strategie § 3.3 — verhaltens-erhaltend).
// Wirft also ein vom Handler aufgerufener Helfer (hier store.addTranscript), fliegt der
// Fehler aus dem Handler HERAUS (statt geschluckt zu werden) — erst der Listener loggt
// ihn. Dieser Test pinnt die Naht: niemand soll den Guard versehentlich in den Handler
// ziehen (das waere eine stille Verhaltensaenderung gegenueber dem heutigen System).
test("Crash-Guard liegt im Listener: ein Throw aus store.addTranscript propagiert", () => {
  const ctx = makeCtx({
    store: {
      addTranscript: () => {
        throw new Error("store kaputt");
      },
    },
  });
  assert.throws(
    () => handleOpenAiEvent({ type: "response.audio_transcript.done", transcript: "hallo" }, ctx),
    /store kaputt/,
  );
});

// ---- In-Handler-Guard: das EINZIGE try/catch INNERHALB von handleOpenAiEvent ----
// In response.done wird item.arguments geparst: `try { args = JSON.parse(...) } catch {}`.
// Kaputtes JSON -> args bleibt {}, KEIN Throw. Getestet ueber den end_call-Zweig, der
// (anders als der generische Tool-Pfad) KEIN execTool aufruft — execTool ist ein
// Modul-Import (nicht ueber ctx injizierbar), end_call dagegen ruft nur ctx.scheduleHangup.
test("kaputtes function_call.arguments wirft nicht (In-Handler-Guard -> args = {})", () => {
  const ctx = makeCtx();
  assert.doesNotThrow(() =>
    handleOpenAiEvent(
      {
        type: "response.done",
        response: {
          output: [
            { type: "function_call", name: "end_call", arguments: "{kein-json", call_id: "x" },
          ],
        },
      },
      ctx,
    ),
  );
  // end_call-Zweig lief genau einmal trotz unparsebarer arguments ...
  assert.deepEqual(ctx.calls.scheduleHangup, ["end_call von KI"]);
  // ... und response.done hat activeResponse zurueckgesetzt.
  assert.equal(ctx.state.activeResponse, false);
});
