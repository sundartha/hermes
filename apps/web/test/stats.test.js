// W3-Tests: die reinen, DOM-freien Dashboard-Statistik-Helfer (lib/api.js).
// `now` wird injiziert -> die zeit-abhaengigen Zahlen (Woche/Monat) sind
// deterministisch (P12-R, kein Verlass auf die echte Uhr). Laeuft mit node:test
// ohne Netz/DOM.
import { test } from "node:test";
import assert from "node:assert/strict";

import { callDurationSec, callStats, formatCallDuration } from "../src/lib/api.js";

// ---- callDurationSec: answeredAt -> endedAt, fail-closed auf 0 ---------------
test("callDurationSec: Dauer aus answeredAt/endedAt, sonst 0", () => {
  assert.equal(
    callDurationSec({ answeredAt: "2026-06-23T09:00:00.000Z", endedAt: "2026-06-23T09:05:00.000Z" }),
    300
  );
  // Nicht beantwortet / noch aktiv -> 0 (fehlender Zeitstempel).
  assert.equal(callDurationSec({ endedAt: "2026-06-23T09:05:00.000Z" }), 0);
  assert.equal(callDurationSec({ answeredAt: "2026-06-23T09:00:00.000Z" }), 0);
  // endedAt <= answeredAt -> 0 (keine Negativdauer).
  assert.equal(
    callDurationSec({ answeredAt: "2026-06-23T09:05:00.000Z", endedAt: "2026-06-23T09:00:00.000Z" }),
    0
  );
  // Ungueltige/leere Eingaben -> 0.
  assert.equal(callDurationSec({ answeredAt: "nope", endedAt: "nope" }), 0);
  assert.equal(callDurationSec(null), 0);
  assert.equal(callDurationSec({}), 0);
});

// ---- formatCallDuration: de-Formatierung, Grenzfaelle -----------------------
test("formatCallDuration: 0/< 1 Min/Min/Std-Grenzen", () => {
  assert.equal(formatCallDuration(0), "0 Min");
  assert.equal(formatCallDuration(30), "< 1 Min");
  assert.equal(formatCallDuration(60), "1 Min");
  assert.equal(formatCallDuration(90), "1 Min"); // abgerundet
  assert.equal(formatCallDuration(480), "8 Min");
  assert.equal(formatCallDuration(3600), "1 Std");
  assert.equal(formatCallDuration(3660), "1 Std 1 Min");
  assert.equal(formatCallDuration(7320), "2 Std 2 Min");
  // Defensive: negativ/NaN -> 0 Min.
  assert.equal(formatCallDuration(-5), "0 Min");
  assert.equal(formatCallDuration(NaN), "0 Min");
});

// ---- callStats: abgeleitete Zahlen bei fixem now ----------------------------
test("callStats: total/in-out/summary/dauer/woche/monat aus calls[]", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");
  const data = {
    calls: [
      // heute: diese Woche + dieser Monat, outbound, mit Summary, 300s
      {
        direction: "outbound",
        startedAt: "2026-06-23T09:00:00.000Z",
        answeredAt: "2026-06-23T09:00:10.000Z",
        endedAt: "2026-06-23T09:05:10.000Z",
        summary: "Termin bestaetigt",
      },
      // vor 3 Tagen: diese Woche + dieser Monat, inbound, ohne Summary, 60s
      {
        direction: "inbound",
        startedAt: "2026-06-20T10:00:00.000Z",
        answeredAt: "2026-06-20T10:00:00.000Z",
        endedAt: "2026-06-20T10:01:00.000Z",
      },
      // 1. des Monats: dieser Monat, NICHT diese Woche, inbound, nicht beantwortet -> 0s
      { direction: "inbound", startedAt: "2026-06-01T10:00:00.000Z" },
      // letzter Monat: weder Woche noch Monat, outbound, mit Summary, 120s
      {
        direction: "outbound",
        startedAt: "2026-05-15T10:00:00.000Z",
        answeredAt: "2026-05-15T10:00:00.000Z",
        endedAt: "2026-05-15T10:02:00.000Z",
        summary: "Rueckruf erledigt",
      },
      // ohne startedAt: zaehlt in total/inbound, aber nicht in Woche/Monat
      { direction: "inbound" },
    ],
  };
  const s = callStats(data, now);
  assert.equal(s.total, 5);
  assert.equal(s.outbound, 2);
  assert.equal(s.inbound, 3);
  assert.equal(s.withSummary, 2);
  assert.equal(s.durationSec, 480); // 300 + 60 + 0 + 120 + 0
  assert.equal(s.thisWeek, 2); // heute + vor 3 Tagen
  assert.equal(s.thisMonth, 3); // 23., 20., 01. Juni
});

test("callStats: leeres/fehlendes state -> alle Zahlen 0", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");
  for (const input of [undefined, null, {}, { calls: null }]) {
    assert.deepEqual(callStats(input, now), {
      total: 0,
      thisWeek: 0,
      thisMonth: 0,
      inbound: 0,
      outbound: 0,
      withSummary: 0,
      durationSec: 0,
    });
  }
});
