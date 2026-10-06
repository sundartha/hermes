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
const DOMESTIC_TO = "+4915112345678";
const TARIFF_ENV = {
  VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS),
  VOICE_TARIFF_DEFAULT_CENTS: "300",
};

const ZOMBIE_MAX_S = 60;
const ZOMBIE_ANSWERED_AT = "2020-01-01T00:00:00.000Z";
const ZOMBIE_ENDED_AT = new Date(
  Date.parse(ZOMBIE_ANSWERED_AT) + ZOMBIE_MAX_S * 1000,
).toISOString();
const ZOMBIE_MINUTES = 1;

test("Boot-Re-Arm terminalisiert einen Zombie gekappt + gebucht (nie Boot-Zeit)", async () => {
  const srv = await startServer({
    env: TARIFF_ENV,
    seed: seedState({
      calls: [
        seedCall({
          id: "zombie",
          direction: "outbound",
          to: DOMESTIC_TO,
          from: DOMESTIC_TEST_NUMBER.e164,
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
    const s = await waitForStoreState(
      srv,
      (st) => st.calls.find((c) => c.id === "zombie")?.billedAt,
    );
    const zombie = s.calls.find((c) => c.id === "zombie");
    assert.equal(zombie.status, "failed", "Zombie ist terminal (nicht mehr active)");
    assert.equal(
      zombie.endedAt,
      ZOMBIE_ENDED_AT,
      "endedAt = gekappter Anker (answeredAt + Max-Dauer), NIE Boot-Zeit",
    );
    assert.equal(
      s.usage[BOOTSTRAP_TENANT_ID].costCents,
      ZOMBIE_MINUTES * DOMESTIC_TARIFF_CENTS,
      "gebuchte Minuten = gekappte Dauer x Inlandstarif (genau einmal)",
    );
  } finally {
    await srv.stop();
  }
});

test("Boot-Re-Arm laesst einen aktiven Call mit Restzeit active (Timer neu armiert)", async () => {
  const answeredAt = new Date(Date.now() - 10_000).toISOString();
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
