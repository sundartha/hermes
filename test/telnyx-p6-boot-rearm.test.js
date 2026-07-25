// P6 (PLAN-TELNYX-AI-ASSISTANT.md, Phase telnyx-p6, Befund 1): Boot-Re-Arm muss AUCH
// einen C-Telnyx-Call (callControlId gesetzt, twilioSid=null) korrekt terminalisieren
// bzw. neu armieren. rearmActiveCallTimers() hat keinen voiceEngine-Guard fuer die
// Budget-Engine, verarbeitet also auch C-Telnyx-Calls - ohne P6/hangUpAction haette der
// Cap-Timer nach einem Deploy trotzdem einen TeXML-endCall(null) versucht (still
// wirkungslos), der Provider-Leg waere nie real beendet worden (Kostenexplosion). Echter
// Boot als Kindprozess, FAKE_ORIGINATE=true (registry.js fakeVoice, netzfreier No-op fuer
// endCallViaCallControl) macht den Test deterministisch ohne echten Telnyx-Netzzugriff.
// Muster/Tarif-Setup gespiegelt von max-duration-rearm.test.js (json-Backend).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  waitForLog,
  waitForStoreState,
  DOMESTIC_TEST_NUMBER,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const DOMESTIC_TARIFF_CENTS = 20;
const DOMESTIC_TO = "+4915112345678"; // DE -> Inlandstarif
const TARIFF_ENV = {
  VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS),
  VOICE_TARIFF_DEFAULT_CENTS: "300",
  FAKE_ORIGINATE: "true", // netzfreier Call-Control-Hangup (kein echter Telnyx-Request)
};

// Zombie-Anker: fixer, weit zurueckliegender answeredAt -> Restzeit garantiert <=0. Der
// gekappte End-Anker ist deterministisch answeredAt + ZOMBIE_MAX_S (NIE Boot-Zeit/2026).
const ZOMBIE_MAX_S = 60;
const ZOMBIE_ANSWERED_AT = "2020-01-01T00:00:00.000Z";
const ZOMBIE_ENDED_AT = new Date(
  Date.parse(ZOMBIE_ANSWERED_AT) + ZOMBIE_MAX_S * 1000,
).toISOString();
const ZOMBIE_MINUTES = 1; // ceil(60s / 60s)

test("R1: Boot-Re-Arm terminalisiert einen C-Telnyx-Zombie (callControlId, kein twilioSid) gekappt + gebucht", async () => {
  const srv = await startServer({
    env: TARIFF_ENV,
    seed: seedState({
      calls: [
        seedCall({
          id: "zombie_cc",
          direction: "outbound",
          to: DOMESTIC_TO,
          // Absender mit +49: der Inlandssatz greift seit P5 nur bei gleicher Vorwahl an
          // BEIDEN Enden (seedCall-Default ist die US-DID = Auslands-Leg).
          from: DOMESTIC_TEST_NUMBER.e164,
          status: "active",
          provider: "telnyx",
          twilioSid: null,
          callControlId: "cc_zombie",
          answeredAt: ZOMBIE_ANSWERED_AT,
          startedAt: ZOMBIE_ANSWERED_AT,
          endedAt: null,
          maxDurationS: ZOMBIE_MAX_S,
        }),
      ],
    }),
  });
  try {
    const s = await waitForStoreState(
      srv,
      (st) => st.calls.find((c) => c.id === "zombie_cc")?.billedAt,
    );
    const zombie = s.calls.find((c) => c.id === "zombie_cc");
    assert.equal(zombie.status, "failed", "Zombie ist terminal (nicht mehr active)");
    assert.equal(
      zombie.endedAt,
      ZOMBIE_ENDED_AT,
      "endedAt = gekappter Anker (answeredAt + Max-Dauer), NIE Boot-Zeit",
    );
    assert.equal(
      s.usage[BOOTSTRAP_TENANT_ID].costCents,
      ZOMBIE_MINUTES * DOMESTIC_TARIFF_CENTS,
      "gebuchte Minuten = gekappte Dauer x Inlandstarif (genau einmal) - rearm orphant den C-Telnyx-Cap NICHT mehr",
    );
  } finally {
    await srv.stop();
  }
});

test("R2: Boot-Re-Arm laesst einen aktiven C-Telnyx-Call mit Restzeit active (Timer neu armiert)", async () => {
  const answeredAt = new Date(Date.now() - 10_000).toISOString(); // vor 10s, max 180 -> ~170s Rest
  const srv = await startServer({
    env: TARIFF_ENV,
    seed: seedState({
      calls: [
        seedCall({
          id: "live_cc",
          direction: "outbound",
          to: DOMESTIC_TO,
          status: "active",
          provider: "telnyx",
          twilioSid: null,
          callControlId: "cc_live",
          answeredAt,
          endedAt: null,
          maxDurationS: 180,
        }),
      ],
    }),
  });
  try {
    await waitForLog(srv, /\[rearm\] aktive Calls beim Boot: 1 re-armed, 0 terminalisiert/);
    const live = srv.readStore().calls.find((c) => c.id === "live_cc");
    assert.equal(live.status, "active", "aktiver C-Telnyx-Call mit Restzeit bleibt active");
    assert.equal(live.endedAt, null, "kein Ende gesetzt (nicht terminalisiert)");
  } finally {
    await srv.stop();
  }
});
