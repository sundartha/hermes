// F10 (A6, T4) - Boot-Re-Arm der Max-Dauer-Timer (rearmActiveCallTimers).
//
// Ein Deploy/Restart toetet den In-Prozess-setTimeout jedes laufenden Calls. Ohne Re-Arm
// waere der harte Max-Dauer-Cap (Absolute Regel 1) nach jedem Boot weg und eine beim Boot
// bereits ueber die Max-Dauer gelaufene aktive Zeile bliebe fuer immer "active" (Phantom).
// Dieser Test faehrt den Kindprozess mit geseedeten aktiven Calls hoch (echter Boot) und
// prueft die zwei Wege:
//   (1) Zombie (Anker weit in der Vergangenheit, Restzeit<=0) -> beim Boot terminalisiert:
//       status "failed", endedAt = gekappter Anker (answeredAt + Max-Dauer, NIE Boot-Zeit),
//       Voice-Minuten GEBUCHT (usageFor). Beweist K2 (kein Boot-Zeit-Anker) + genau-einmal.
//   (2) Aktiver Call mit Restzeit (Anker vor 10s, max 180) -> bleibt "active"; das Boot-Log
//       [rearm] weist 1 re-armed / 0 terminalisiert aus (Timer neu armiert, nicht beendet).
//
// Rot-vor-Fix: ohne rearmActiveCallTimers bleibt der Zombie "active" (kein [rearm]-Log,
// keine Buchung) -> beide Assertions von Fall (1) und der waitForLog von Fall (2) fehlen.
//
// Netzfrei/deterministisch: leeres Transkript -> finishCall returnt VOR jedem LLM-Call
// (kein Anthropic-Mock). twilioSid=null (seedCall-Default) -> kein Provider-endCall.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, CENTS_PER_EUR } from "../src/store/defaults.js";

// Tarif so, dass die gebuchte Zombie-Minute eine sichtbare Summe ergibt (G25, Muster
// finishcall-billing-once.test.js - kein nacktes Cent-Literal).
const DOMESTIC_TARIFF_CENTS = 20;
const DOMESTIC_TO = "+4915112345678"; // DE -> Inlandstarif
const TARIFF_ENV = {
  VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS),
  VOICE_TARIFF_DEFAULT_CENTS: "300",
};
const eur = (cents) => cents / CENTS_PER_EUR;

// Zombie-Anker: fixer, weit zurueckliegender answeredAt -> Restzeit garantiert <=0. Der
// gekappte End-Anker ist deterministisch answeredAt + ZOMBIE_MAX_S (NIE Boot-Zeit/2026).
const ZOMBIE_MAX_S = 60;
const ZOMBIE_ANSWERED_AT = "2020-01-01T00:00:00.000Z";
const ZOMBIE_ENDED_AT = new Date(
  Date.parse(ZOMBIE_ANSWERED_AT) + ZOMBIE_MAX_S * 1000,
).toISOString();
const ZOMBIE_MINUTES = 1; // ceil(60s / 60s)

// Store pollen, bis das Praedikat greift (die Zombie-Terminalisierung laeuft async:
// setCallEndedAt + finishCall + save). waitForLog deckt nur stdout ab.
async function waitForStore(srv, predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(srv.readStore())) {
    if (Date.now() > deadline)
      throw new Error(`Store-Zustand nicht erreicht:\n${JSON.stringify(srv.readStore().calls)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  return srv.readStore();
}

test("Boot-Re-Arm terminalisiert einen Zombie gekappt + gebucht (nie Boot-Zeit)", async () => {
  const srv = await startServer({
    env: TARIFF_ENV,
    seed: seedState({
      calls: [
        seedCall({
          id: "zombie",
          direction: "outbound",
          to: DOMESTIC_TO,
          status: "active",
          answeredAt: ZOMBIE_ANSWERED_AT,
          startedAt: ZOMBIE_ANSWERED_AT,
          endedAt: null,
          maxDurationS: ZOMBIE_MAX_S,
        }),
      ],
    }),
  });
  try {
    const s = await waitForStore(srv, (st) => st.calls.find((c) => c.id === "zombie")?.billedAt);
    const zombie = s.calls.find((c) => c.id === "zombie");
    assert.equal(zombie.status, "failed", "Zombie ist terminal (nicht mehr active)");
    assert.equal(
      zombie.endedAt,
      ZOMBIE_ENDED_AT,
      "endedAt = gekappter Anker (answeredAt + Max-Dauer), NIE Boot-Zeit",
    );
    assert.equal(
      s.usage[BOOTSTRAP_TENANT_ID].costEur,
      eur(ZOMBIE_MINUTES * DOMESTIC_TARIFF_CENTS),
      "gebuchte Minuten = gekappte Dauer x Inlandstarif (genau einmal)",
    );
  } finally {
    await srv.stop();
  }
});

test("Boot-Re-Arm laesst einen aktiven Call mit Restzeit active (Timer neu armiert)", async () => {
  const answeredAt = new Date(Date.now() - 10_000).toISOString(); // vor 10s, max 180 -> ~170s Rest
  const srv = await startServer({
    env: TARIFF_ENV,
    seed: seedState({
      calls: [
        seedCall({
          id: "live",
          direction: "outbound",
          to: DOMESTIC_TO,
          status: "active",
          answeredAt,
          endedAt: null,
          maxDurationS: 180,
        }),
      ],
    }),
  });
  try {
    await waitForLog(srv, /\[rearm\] aktive Calls beim Boot: 1 re-armed, 0 terminalisiert/);
    const live = srv.readStore().calls.find((c) => c.id === "live");
    assert.equal(live.status, "active", "aktiver Call mit Restzeit bleibt active");
    assert.equal(live.endedAt, null, "kein Ende gesetzt (nicht terminalisiert)");
  } finally {
    await srv.stop();
  }
});
