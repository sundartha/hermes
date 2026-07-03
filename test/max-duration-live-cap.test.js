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

test(
  "Live-Cap: laufender Call erreicht die Max-Dauer waehrend des normalen Betriebs " +
    "(kein Boot-Rearm) -> completed + providerCallSid + genau einmal gebucht",
  async () => {
    const srv = await startServer({ env: { FAKE_ORIGINATE: "true" } });
    try {
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
      assert.ok(
        body.twilioSid?.startsWith("fake_"),
        "providerCallSid kommt vom FAKE_ORIGINATE-Seam (netzfrei)",
      );

      const s = await waitForStoreState(
        srv,
        (st) => st.calls.find((c) => c.id === body.callId)?.billedAt,
        POLL_TIMEOUT_MS,
      );
      const call = s.calls.find((c) => c.id === body.callId);
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
