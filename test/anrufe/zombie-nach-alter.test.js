import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, seedState, seedCall, waitForStoreState } from "../helpers.js";

const DOMESTIC_TO = "+4915112345678";
const MAX_S = 60;
const MS_PER_MINUTE = 60_000;
const FRISTEN_TAKT_MS = "40";

function abgelaufenVorMinuten(id, minuten) {
  const answeredAt = new Date(Date.now() - MAX_S * 1000 - minuten * MS_PER_MINUTE).toISOString();
  return seedCall({
    id, direction: "outbound", to: DOMESTIC_TO, status: "active",
    answeredAt, startedAt: answeredAt, endedAt: null, maxDurationS: MAX_S,
  });
}

test("Ein frisch gestarteter Prozess beendet einen vor 1 Minute abgelaufenen Anruf als completed, einen vor 11 Minuten abgelaufenen als failed", async () => {
  const srv = await startServer({
    env: { FRISTEN_TAKT_MS },
    seed: seedState({ calls: [abgelaufenVorMinuten("jung", 1), abgelaufenVorMinuten("alt", 11)] }),
  });
  try {
    const stand = await waitForStoreState(
      srv,
      (st) => st.calls.find((c) => c.id === "jung")?.billedAt && st.calls.find((c) => c.id === "alt")?.billedAt,
    );
    assert.equal(stand.calls.find((c) => c.id === "jung").status, "completed");
    assert.equal(stand.calls.find((c) => c.id === "alt").status, "failed");
  } finally {
    await srv.stop();
  }
});

test("Ein vor 9 Minuten abgelaufener Anruf endet completed", async () => {
  const srv = await startServer({
    env: { FRISTEN_TAKT_MS },
    seed: seedState({ calls: [abgelaufenVorMinuten("neun", 9)] }),
  });
  try {
    const stand = await waitForStoreState(srv, (st) => st.calls.find((c) => c.id === "neun")?.billedAt);
    assert.equal(stand.calls.find((c) => c.id === "neun").status, "completed");
  } finally {
    await srv.stop();
  }
});
