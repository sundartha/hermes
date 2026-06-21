// Integrationstest: /voice/status verarbeitet ein Telnyx-"speak_failed"-Command-Event.
// Symptom: das server-seitige TTS (<Say> ueber Azure-NTTS) faellt sporadisch aus und
// schneidet Offenlegung/Antwort ab; Telnyx meldet das als Command-Event OHNE CallStatus.
// Dieser Test pinnt das neue Verhalten:
//   a) Telnyx speak_failed -> 200, EINE [voice/speak]-Logzeile (outcome=failed + reason),
//      PII-frei (keine Telefonnummern), und KEIN Lifecycle-Effekt (Call bleibt aktiv,
//      kein answeredAt/endedAt) UND keine [voice/status]-Zeile (Speak != Lifecycle).
//   b) Regression: ein normaler Telnyx-Lifecycle-Callback (completed) endet den Call
//      weiterhin (der additive Speak-Zweig stoert den Bestandspfad NICHT).
//
// Rein offline (helpers.startServer, echter Kindprozess), KEIN Telefonie-Netz. Der
// Signatur-Check ist per BASE_ENV (SKIP_TWILIO_SIGNATURE_CHECK) aus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";

const SEED_FROM = "+15005550006";
const SEED_TO = "+4915112345678";

// Telnyx-Speak-Command-Event als JSON (Call-Control-Form) an /voice/status?callId=.
const postSpeakEvent = (srv, callId, body) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const postLifecycle = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

// Wartet auf den persistierten STORE-Effekt (nicht nur auf eine Log-Zeile): der
// Store-Write (endCallRecord -> writeFileSync) passiert NACH der Log-Emission, ein
// reines waitForLog wuerde also vor dem Schreiben lesen (Race, F.I.R.S.T. Repeatable).
// Lokal gehalten (nicht in helpers.js), um die geteilte Helper-Datei nicht anzufassen.
async function waitForCall(srv, callId, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const call = srv.readStore().calls.find((c) => c.id === callId);
    if (call && predicate(call)) return call;
    if (Date.now() > deadline) throw new Error(`Store-Praedikat fuer ${callId} nicht erfuellt`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("/voice/status: Telnyx speak_failed -> [voice/speak]-Log, PII-frei, kein Lifecycle-Effekt", async () => {
  const srv = await startServer({
    seed: seedState({
      calls: [seedCall({ id: "sp_failed", provider: "telnyx", status: "active" })],
    }),
  });
  try {
    const r = await postSpeakEvent(srv, "sp_failed", {
      data: { event_type: "call.speak.failed", payload: { status: "failed" } },
    });
    assert.equal(r.status, 200);

    await waitForLog(srv, /\[voice\/speak\][^\n]*"callId":"sp_failed"/);
    const line = srv.stdout
      .split("\n")
      .find((l) => l.includes("[voice/speak]") && l.includes('"callId":"sp_failed"'));
    const ev = JSON.parse(line.slice(line.indexOf("{")));
    assert.equal(ev.provider, "telnyx");
    assert.equal(ev.outcome, "failed");
    assert.equal(ev.reason, "failed");

    // Speak-Event ist KEIN Lifecycle-Uebergang: keine [voice/status]-Zeile fuer den Call.
    assert.ok(
      !srv.stdout.match(/\[voice\/status\][^\n]*"callId":"sp_failed"/),
      `speak_failed darf keine [voice/status]-Zeile erzeugen:\n${srv.stdout}`,
    );

    // KEIN Store-Effekt: Call bleibt aktiv, nicht beantwortet, nicht beendet.
    const call = srv.readStore().calls.find((c) => c.id === "sp_failed");
    assert.equal(call.status, "active");
    assert.equal(call.answeredAt, null);
    assert.equal(call.endedAt, null);

    // PII-Gate: keine Telefonnummern in der [voice/speak]-Zeile (DSGVO/Pre-Mortem).
    assert.ok(!line.includes(SEED_FROM), `From-Nummer im Log (PII): ${line}`);
    assert.ok(!line.includes(SEED_TO), `To-Nummer im Log (PII): ${line}`);
  } finally {
    await srv.stop();
  }
});

test("/voice/status: Regression - Telnyx-Lifecycle (completed) endet den Call weiterhin", async () => {
  const srv = await startServer({
    seed: seedState({
      calls: [seedCall({ id: "sp_lifecycle", provider: "telnyx", status: "active" })],
    }),
  });
  try {
    const r = await postLifecycle(srv, "sp_lifecycle", { CallStatus: "completed", CallDuration: "30" });
    assert.equal(r.status, 200);
    // Auf den STORE-Effekt pollen, nicht auf die Log-Zeile (siehe waitForCall): sonst
    // liest der Test den Store ggf. vor dem endCallRecord-writeFileSync (Race).
    const call = await waitForCall(srv, "sp_lifecycle", (c) => c.status === "completed");
    assert.ok(call.endedAt, "completed: endedAt muss gesetzt sein");
  } finally {
    await srv.stop();
  }
});
