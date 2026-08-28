// Phase 1 (#tk_tu9zt9a): /voice/status liest den Call-Lifecycle jetzt PROVIDER-bewusst
// (analog extractSpeech). Telnyx-Lifecycle-
// Events + CallDuration werden als PII-freie Diagnose im [voice/status]-Log sichtbar.
// Dieser Test pinnt:
//   a) Telnyx completed + CallDuration   -> diagnostics.callDurationS === 45 + Call endet
//   b) Telnyx answered ohne CallDuration -> diagnostics === {} + markAnswered
//   c) entfallen mit C-P4 (war: Call auf einem anderen Anbieter als Telnyx), s.u.
//   d) Telnyx unbekannter CallStatus -> kein Fehler, kein Status-Effekt; diagnostics
//      NUR bei vorhandener CallDuration
//   e) Handler-Effekt auf den Store (markAnswered/endCallRecord) per readStore()
//      + unbekannter Call erzeugt KEINE Logzeile + kein PII (Telefonnummern) im Log
//   f) Call ganz ohne provider -> DEFAULT_PROVIDER (C-P1: Telnyx)
//
// Rein offline, KEIN echtes Telefonie-Netz. Der completed-Pfad ruft finishCall, das bei
// LEEREM Transkript VOR jedem Anthropic-Call early-returnt (server.js, finishCall) ->
// kein LLM-Mock noetig. Zur Struktur: src/server.js ist KEIN import-sicheres Modul
// (Top-Level app.listen, kein Export) - KEIN Test importiert es. Der etablierte Weg fuer
// Route+Store-Tests ist helpers.startServer (vgl. outbound-recv-log.test.js): die ECHTE
// Route gegen einen Kindprozess, deterministisch und real verdrahtet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";

// Seed-Defaults von seedCall: from=+15005550006, to=+4915112345678. Beide duerfen NIE
// im [voice/status]-Log auftauchen (DSGVO/PII-Gate).
const SEED_FROM = "+15005550006";
const SEED_TO = "+4915112345678";

// Liest die [voice/status]-Logzeile fuer eine callId und liefert das geparste JSON
// ({callId, status, provider, diagnostics}). waitForLog stellt sicher, dass der Handler
// (Log + nachfolgender synchroner Store-Effekt) gelaufen ist, bevor wir lesen.
async function statusEvent(srv, callId) {
  await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId}"`));
  const line = srv.stdout
    .split("\n")
    .find((l) => l.includes("[voice/status]") && l.includes(`"callId":"${callId}"`));
  return JSON.parse(line.slice(line.indexOf("{")));
}

const postStatus = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

test("/voice/status provider-bewusst: Telnyx-Lifecycle + Diagnose + Store-Effekt + PII-frei", async () => {
  const srv = await startServer({
    seed: seedState({
      calls: [
        seedCall({ id: "st_tnx_done", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_ans", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_unk", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_unk_dur", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_default_prog", status: "active" }), // kein provider -> DEFAULT_PROVIDER
      ],
    }),
  });
  try {
    // Zuerst: unbekannter Call -> 200, aber KEINE Logzeile, KEIN Effekt (if (!call) return).
    // Wird vor allen bekannten Faellen abgesetzt, also garantiert vor deren Logs verarbeitet.
    let r = await postStatus(srv, "st_unknown_xyz", {
      CallStatus: "completed",
      CallDuration: "99",
    });
    assert.equal(r.status, 200);

    // a) Telnyx completed + CallDuration -> callDurationS===45.
    r = await postStatus(srv, "st_tnx_done", { CallStatus: "completed", CallDuration: "45" });
    assert.equal(r.status, 200);
    let ev = await statusEvent(srv, "st_tnx_done");
    assert.equal(ev.provider, "telnyx");
    assert.equal(ev.status, "completed");
    assert.deepEqual(ev.diagnostics, { callDurationS: 45 });

    // b) Telnyx answered OHNE CallDuration -> diagnostics === {}.
    r = await postStatus(srv, "st_tnx_ans", { CallStatus: "answered" });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_tnx_ans");
    assert.equal(ev.provider, "telnyx");
    assert.deepEqual(ev.diagnostics, {});

    // c) C-P4: hier stand "Twilio in-progress (provider explizit twilio) -> diagnostics
    // === {}". Ihr Gegenstand war ein Call auf einem ANDEREN Anbieter als Telnyx; den
    // gibt es nicht mehr. Der Fall ist entfallen, nicht gruen gemacht - der Rueckfall
    // ohne provider-Feld (f, st_default_prog) traegt die Default-Aufloesung weiter.
    // BEFUND fuer C-P5, hier bewusst NICHT gefixt (Scope): steht in einer Bestands-DB
    // noch eine Zeile mit provider='twilio', wirft webhookEvents() in diesem Handler
    // (routes/voice.js:510-528) und /voice/status antwortet 500 statt 200. In der
    // Produktions-DB gibt es keine solche Zeile (gemessen 2026-08-07: 3 Nummern,
    // 67 Anrufe, alle telnyx) - deshalb kein Live-Risiko, aber eine offene Kante.

    // d) Telnyx unbekannter CallStatus: kein Fehler, diagnostics nur bei CallDuration.
    r = await postStatus(srv, "st_tnx_unk", { CallStatus: "ringing" });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_tnx_unk");
    assert.equal(ev.status, "ringing");
    assert.deepEqual(ev.diagnostics, {});

    r = await postStatus(srv, "st_tnx_unk_dur", { CallStatus: "ringing", CallDuration: "12" });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_tnx_unk_dur");
    assert.deepEqual(ev.diagnostics, { callDurationS: 12 });

    // f) Call ganz ohne provider -> DEFAULT_PROVIDER (C-P1: Telnyx). Nur provider wird
    // assertiert, nicht Status/Diagnostics - der Rueckfall ist die Aussage dieses Blocks,
    // nicht die Telnyx-Lifecycle-Semantik (die deckt Fall a/b bereits ab).
    r = await postStatus(srv, "st_default_prog", { CallStatus: "in-progress" });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_default_prog");
    assert.equal(ev.provider, "telnyx", "Call ohne provider faellt bewusst auf DEFAULT_PROVIDER");

    // e) Handler-Effekt auf den Store (Quelle der Wahrheit: persistierter Store).
    const calls = Object.fromEntries(srv.readStore().calls.map((c) => [c.id, c]));
    // completed -> endCallRecord(active->completed), endedAt gesetzt.
    assert.equal(calls.st_tnx_done.status, "completed");
    assert.ok(calls.st_tnx_done.endedAt, "completed: endedAt muss gesetzt sein");
    // answered/in-progress -> markAnswered (answeredAt), Status bleibt active.
    assert.ok(calls.st_tnx_ans.answeredAt, "answered: answeredAt muss gesetzt sein");
    assert.equal(calls.st_tnx_ans.status, "active");
    // in-progress -> markAnswered: seit C-P4 am provider-losen Call (Fall f) gemessen,
    // nachdem der frueher hierfuer benutzte Twilio-Call entfallen ist.
    assert.ok(calls.st_default_prog.answeredAt, "in-progress: answeredAt muss gesetzt sein");
    // unbekannter Status -> KEIN Effekt (weder answered noch beendet).
    assert.equal(calls.st_tnx_unk.answeredAt, null);
    assert.equal(calls.st_tnx_unk.status, "active");

    // Unbekannter Call: keine [voice/status]-Logzeile (if (!call) return, vor dem Log).
    assert.ok(
      !srv.stdout.includes('"callId":"st_unknown_xyz"'),
      `Unbekannter Call darf keine [voice/status]-Zeile erzeugen:\n${srv.stdout}`,
    );

    // PII-Gate: keine Telefonnummern in den [voice/status]-Logzeilen (DSGVO/Pre-Mortem).
    const statusLines = srv.stdout.split("\n").filter((l) => l.includes("[voice/status]"));
    assert.ok(statusLines.length >= 5, "alle bekannten Faelle muessen geloggt sein");
    for (const l of statusLines) {
      assert.ok(!l.includes(SEED_FROM), `From-Nummer im Log (PII): ${l}`);
      assert.ok(!l.includes(SEED_TO), `To-Nummer im Log (PII): ${l}`);
    }
  } finally {
    await srv.stop();
  }
});

// A1 (#tk_tu9zt9a): Telnyx-"Call Completed"-Callback liefert die Hangup-Ursache in
// PascalCase-Feldern (HangupCause/HangupSource/SipHangupCause; Feldnamen aus der
// Telnyx-OpenAPI-Spec texml/calls.yml). /voice/status loggt sie jetzt als PII-freie
// Diagnose - das Telnyx-Call-Ende war beim Debugging vorher blind. Dieser Test pinnt:
//   a) sauberer completed-Callback -> alle drei Tokens (+ CallDuration) in diagnostics
//   b) unsauberes Hangup-Feld (Freitext/E.164/zu lang) -> verworfen, NIE im Log
test("/voice/status Telnyx: Hangup-Ursache wird PII-frei als Diagnose geloggt", async () => {
  const srv = await startServer({
    seed: seedState({
      calls: [
        seedCall({ id: "st_tnx_hangup", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_hangup_dirty", provider: "telnyx", status: "active" }),
        // CDF1: no-answer-Fall (Status gewinnt vor SIP-Cause 487 -> failureReason "no-answer").
        seedCall({ id: "st_tnx_noanswer", provider: "telnyx", status: "active" }),
      ],
    }),
  });
  try {
    // a) Telnyx completed mit Hangup-Feldern -> alle drei Tokens + CallDuration sichtbar.
    let r = await postStatus(srv, "st_tnx_hangup", {
      CallStatus: "completed",
      CallDuration: "30",
      HangupCause: "normal_clearing",
      HangupSource: "callee",
      SipHangupCause: "486",
    });
    assert.equal(r.status, 200);
    let ev = await statusEvent(srv, "st_tnx_hangup");
    assert.equal(ev.provider, "telnyx");
    assert.equal(ev.status, "completed");
    assert.deepEqual(ev.diagnostics, {
      callDurationS: 30,
      hangupCause: "normal_clearing",
      hangupSource: "callee",
      sipHangupCause: "486",
    });

    // b) Defensiv: unsaubere Hangup-Felder werden verworfen (kein Diagnose-Feld); nur das
    // saubere Token bleibt. Kein PII-Leak. Geprueft: E.164-Form ("+" + Nummer, zu lang)
    // UND ein Mehrwort-ASCII-Freitext (Space nicht in der Allowlist -> kein Klarname-Leak).
    const dirty = `+491511234 ${"x".repeat(60)}`;
    r = await postStatus(srv, "st_tnx_hangup_dirty", {
      CallStatus: "failed",
      HangupCause: dirty,
      HangupSource: "Erika Mustermann", // Mehrwort-ASCII -> muss verworfen werden
      SipHangupCause: "603",
    });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_tnx_hangup_dirty");
    assert.deepEqual(ev.diagnostics, { sipHangupCause: "603" });
    assert.ok(
      !srv.stdout.includes("491511234"),
      `Unsauberes Hangup-Feld darf nicht ins Log: ${srv.stdout}`,
    );
    assert.ok(
      !srv.stdout.includes("Erika Mustermann"),
      `Mehrwort-Freitext darf nicht ins Log: ${srv.stdout}`,
    );

    // CDF1 (Spec a): no-answer + SipHangupCause 487 -> Status gewinnt -> failureReason "no-answer".
    r = await postStatus(srv, "st_tnx_noanswer", { CallStatus: "no-answer", SipHangupCause: "487" });
    assert.equal(r.status, 200);
    await statusEvent(srv, "st_tnx_noanswer");

    // Store-Effekt: beide completed/failed -> Call beendet (endedAt gesetzt).
    const calls = Object.fromEntries(srv.readStore().calls.map((c) => [c.id, c]));
    assert.ok(calls.st_tnx_hangup.endedAt, "completed: endedAt muss gesetzt sein");
    assert.ok(calls.st_tnx_hangup_dirty.endedAt, "failed: endedAt muss gesetzt sein");
    // CDF1 (Spec a+b+d/json): persistierter Fehlergrund am Call-Record.
    assert.equal(calls.st_tnx_noanswer.failureReason, "no-answer", "no-answer: Status gewinnt");
    // OUTBOUND-E2 (S2-1, Runde 3): SIP 603 (Decline) klassifiziert jetzt nach Schuld
    // (sipBase) statt als unklassifiziertes "failed:603" - EIN Fehlervokabular ueber alle
    // Engines (genau der TeXML-/voice-status-Weg, den der 27.08.-Ausfall betraf).
    assert.equal(
      calls.st_tnx_hangup_dirty.failureReason,
      "unreachable:invite-603",
      "failed + SIP 603 -> unreachable:invite-603 (sipBase, S2-1)",
    );
    // Spec (b): erfolgreicher Call traegt KEINEN Grund (null/absent).
    assert.ok(calls.st_tnx_hangup.failureReason == null, "completed: kein failureReason");
  } finally {
    await srv.stop();
  }
});
