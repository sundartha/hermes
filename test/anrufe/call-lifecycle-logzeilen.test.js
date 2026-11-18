import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall, waitForLog, waitForStoreState } from "../helpers.js";

const DOMESTIC_TO = "+4915112345678";
const TAKT_MS = 15000;
const FRISTEN_TAKT_MS = 40;
const MAX_DAUER_S = 180;
const ZEIT_FRIST_MS = 10000;

function aktiverAnruf(id, overrides = {}) {
  return seedCall({
    id,
    direction: "outbound",
    to: DOMESTIC_TO,
    status: "active",
    answeredAt: new Date(Date.now() - 10_000).toISOString(),
    endedAt: null,
    maxDurationS: MAX_DAUER_S,
    ...overrides,
  });
}

test("Boot ohne Neuaufbau: nur der abgelaufene Anruf wird vom Fristen-Lauf beendet, laufende bleiben und das Betriebslog meldet keinen Neuaufbau", async () => {
  const srv = await startServer({
    env: { BUDGET_WATCHDOG_INTERVAL_MS: String(TAKT_MS), FRISTEN_TAKT_MS: String(FRISTEN_TAKT_MS) },
    seed: seedState({
      calls: [
        aktiverAnruf("live1"),
        aktiverAnruf("live2"),
        aktiverAnruf("abgelaufen", { answeredAt: "2020-01-01T00:00:00.000Z", startedAt: "2020-01-01T00:00:00.000Z" }),
      ],
    }),
  });
  try {
    const stand = await waitForStoreState(
      srv,
      (state) => state.calls.find((anruf) => anruf.id === "abgelaufen")?.status === "failed",
      ZEIT_FRIST_MS,
    );
    assert.deepEqual(
      stand.calls.filter((anruf) => anruf.status === "active").map((anruf) => anruf.id),
      ["live1", "live2"],
    );
    assert.doesNotMatch(srv.stdout, /Boot-Re-Arm der Geld-Wache|\[rearm\]/);
  } finally {
    await srv.stop();
  }
});

test("scheitert die Terminalisierung eines Anrufs, steht die Fehlermeldung im Betriebslog", async () => {
  const srv = await startServer({
    env: { FRISTEN_TAKT_MS: String(FRISTEN_TAKT_MS) },
    seed: seedState({
      calls: [
        aktiverAnruf("kaputt", {
          answeredAt: "2020-01-01T00:00:00.000Z",
          elNachlaufStartedAt: "kein-zeitpunkt",
          startedAt: "2020-01-01T00:00:00.000Z",
          maxDurationS: 60,
          endedAt: null,
        }),
      ],
    }),
  });
  try {
    await waitForLog(srv, /\[max-duration\] Terminalisierung fehlgeschlagen: Invalid time value/, ZEIT_FRIST_MS);
  } finally {
    await srv.stop();
  }
});
