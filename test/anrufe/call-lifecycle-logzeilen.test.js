import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall, waitForLog } from "../helpers.js";

const DOMESTIC_TO = "+4915112345678";
const TAKT_MS = 15000;
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

test("Boot-Re-Arm der Geld-Wache meldet Zahl der Legs und Takt im Betriebslog", async () => {
  const srv = await startServer({
    env: { BUDGET_WATCHDOG_INTERVAL_MS: String(TAKT_MS) },
    seed: seedState({ calls: [aktiverAnruf("live1"), aktiverAnruf("live2")] }),
  });
  try {
    await waitForLog(
      srv,
      /\[budget\] Boot-Re-Arm der Geld-Wache: 2 aktive Legs \(Takt 15000 ms\)/,
      ZEIT_FRIST_MS,
    );
    await waitForLog(
      srv,
      /\[rearm\] aktive Calls beim Boot: 2 re-armed, 0 terminalisiert \(Zombie\)/,
      ZEIT_FRIST_MS,
    );
  } finally {
    await srv.stop();
  }
});

test("scheitert die Terminalisierung eines Anrufs, steht die Fehlermeldung im Betriebslog", async () => {
  const srv = await startServer({
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
