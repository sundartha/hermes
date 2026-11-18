import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";

const MAX_DAUER_S = 2;
const FRIST_MS = 20000;
const ZEILEN = [{ role: "agent", text: "Preis fuer 5 l Olivenoel?" }];
const NICHT_ERREICHBAR = "http://127.0.0.1:9";

const anruf = (id, zusatz) => seedCall({ id, answeredAt: new Date().toISOString(), maxDurationS: MAX_DAUER_S, ...zusatz });

test("Frist-Ende Bewertung: nur ein ausgehender EL-Anruf mit Gespraech endet an der Hoechstdauer als completed", async () => {
  const srv = await startServer({
    env: { FRISTEN_TAKT_MS: "40", ANTHROPIC_BASE_URL: NICHT_ERREICHBAR, ANTHROPIC_API_KEY: "test-frist-ende-key" },
    seed: seedState({
      calls: [
        anruf("call_el_mit", { costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, transcript: ZEILEN }),
        anruf("call_el_ohne", { costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, transcript: [] }),
        anruf("call_fremd", { transcript: ZEILEN }),
      ],
    }),
  });
  try {
    const stand = await waitForStoreState(srv, (s) => s.calls.every((c) => c.status !== "active"), FRIST_MS);
    const statusVon = (id) => stand.calls.find((c) => c.id === id).status;
    assert.equal(statusVon("call_el_mit"), "completed");
    assert.equal(statusVon("call_el_ohne"), "failed");
    assert.equal(statusVon("call_fremd"), "failed");
    for (const c of stand.calls) assert.equal(c.failureReason, "max-duration-cap");
  } finally {
    await srv.stop();
  }
});
