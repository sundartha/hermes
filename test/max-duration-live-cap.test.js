// F10 (A6, T5) - Live-Cap: der TAEGLICHE Pfad (KEIN Boot-Rearm). Ein WAEHREND des
// normalen Betriebs laufender Call erreicht ueber den ECHTEN, live armierten Timer
// (armMaxDurationTimer, gesetzt bei POST /api/calls - NICHT rearmActiveCallTimers beim
// Boot) seine Max-Dauer und wird ueber den EINEN Terminalisierungspfad beendet: status
// "completed" (NICHT "failed" wie beim Boot-Zombie), providerCallSid gesetzt (der
// echte voiceControl(...).endCall()-Aufruf laeuft, s.u.), Voice-Minuten genau einmal
// gebucht (billedAt, F9).
//
// Abgrenzung zu max-duration-rearm.test.js (Boot-Zombie: status "failed",
// providerCallSid=null -> KEIN endCall-Aufruf, Timer wird beim Boot NEU armiert):
// hier feuert der beim Call-Start selbst armierte setTimeout, ohne jeden Restart/
// Rearm dazwischen (kein "[rearm]"-Log im stdout).
//
// Netzfrei/deterministisch: FAKE_ORIGINATE=true ersetzt BEIDE Provider-Aufrufe
// (originateCall UND endCall, registry.js fakeVoice) - originateCall liefert einen
// synthetischen providerCallSid, endCall ist ein netzfreier No-op (Muster
// outbound-reserve-backstop.test.js). place_call fuegt selbst KEINEN Transcript-
// Eintrag hinzu (das macht erst der spaetere /voice/outbound-Webhook, der hier nie
// laeuft) -> leeres Transkript -> finishCall returnt VOR jedem LLM-Call (Muster
// max-duration-rearm.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForStoreState } from "./helpers.js";

const MAX_DURATION_S = 1; // so kurz wie moeglich, damit der Live-Timer den Test nicht ausbremst
const POLL_TIMEOUT_MS = MAX_DURATION_S * 1000 + 3000; // Puffer ueber der exakten Timer-Dauer (Jitter-Toleranz CI)
const DOMESTIC_TO = "+4915112345678"; // DE, kein Denylist-/Premium-Treffer (Muster Bestand)

// Gemeinsamer Auf- und Abbau beider Tests dieser Datei (G5): place_call mit dem
// kuerzestmoeglichen Cap, warten bis der Live-Timer terminalisiert (billedAt gesetzt).
// Liefert Server + terminalisierten Call-Record; der Aufrufer schliesst den Server.
async function placeCappedCall() {
  const srv = await startServer({ env: { FAKE_ORIGINATE: "true" } });
  const res = await fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: DOMESTIC_TO,
      objective: "Test",
      max_duration_s: String(MAX_DURATION_S),
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const s = await waitForStoreState(
    srv,
    (st) => st.calls.find((c) => c.id === body.callId)?.billedAt,
    POLL_TIMEOUT_MS,
  );
  return { srv, body, call: s.calls.find((c) => c.id === body.callId) };
}

test(
  "Live-Cap: laufender Call erreicht die Max-Dauer waehrend des normalen Betriebs " +
    "(kein Boot-Rearm) -> completed + providerCallSid + genau einmal gebucht",
  async () => {
    const { srv, body, call } = await placeCappedCall();
    try {
      assert.ok(
        body.twilioSid?.startsWith("fake_"),
        "providerCallSid kommt vom FAKE_ORIGINATE-Seam (netzfrei)",
      );
      assert.equal(
        call.status,
        "completed",
        "Live-Cap terminalisiert als completed (NICHT failed wie der Boot-Zombie)",
      );
      assert.ok(call.endedAt, "endedAt gesetzt");
      assert.equal(
        call.twilioSid,
        body.twilioSid,
        "providerCallSid bleibt bis zur Terminalisierung erhalten (an endCall durchgereicht)",
      );
      assert.ok(
        !/\[rearm\]/.test(srv.stdout),
        "Terminalisierung lief ueber den LIVE-Timer, nicht ueber rearmActiveCallTimers (kein Boot-Rearm-Log)",
      );
    } finally {
      await srv.stop();
    }
  },
);

// GAP-26 (tasks/i18n-tests/11-luecken-und-e2e.md): ein am Dauer-Cap gestorbener Anruf
// muss maschinenlesbar als solcher erkennbar sein. HEUTE ROT: terminateCappedCall
// (src/telephony/call-lifecycle.js) setzt ueber setCallEndedAt nur status="completed" -
// exakt derselbe Endzustand wie ein regulaer beendeter Anruf. recordFailureReason wird
// AUSSCHLIESSLICH vom Provider-Callback /voice/status gerufen, nie vom Cap-Pfad; das
// Whitelist-Feld failure_reason (get_call_status) bleibt damit null.
// Rot ist hier das Arbeitsergebnis (PLAN-I18N-TESTS 4.1).
// Haelfte (b) des Katalogeintrags (Hold-/Musik-Erkennung, no-speech-Eskalation) ist eine
// Produktaenderung ohne heutiges Subjekt und wird NICHT hier gebaut (Blockreport).
const CAP_FAILURE_MARKER = /cap|max_duration/;
test("GAP-26 (SOLL, rot) - ein am Dauer-Cap terminalisierter Anruf traegt ein maschinenlesbares Cap-Merkmal", async () => {
  const { srv, call } = await placeCappedCall();
  try {
    assert.ok(call.failureReason, "am Cap gestorbener Anruf ist heute nicht von einem erfolgreichen unterscheidbar");
    assert.match(call.failureReason, CAP_FAILURE_MARKER);
  } finally {
    await srv.stop();
  }
});
