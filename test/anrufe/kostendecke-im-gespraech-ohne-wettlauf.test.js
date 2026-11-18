import assert from "node:assert/strict";
import test from "node:test";

import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer, waitForStoreState, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { calleeVon, elVon } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const AUFTRAG = "Tisch fuer zwei reservieren (GW0 ohne Wettlauf)";
const KOSTENDECKE_CENT = 1000;
const RESTBUDGET_CENT = 210;
const TARIF_CENT = "20";
const LAUFENDER_ANRUF_MS = (9 * 60 + 5) * 1000;
const ENDE_FRIST_MS = 6000;
const HANGUP_FRIST_MS = 3000;

function seedMitLaufendemAnruf() {
  const beginn = new Date(Date.now() - LAUFENDER_ANRUF_MS).toISOString();
  const seed = seedState({
    calls: [
      {
        id: "call_gw0_laufend_ohne_wettlauf",
        direction: "outbound",
        status: "active",
        tenantId: BOOTSTRAP_TENANT_ID,
        from: TELNYX_TEST_OWNER_NUMBER.e164,
        to: "+4915112340002",
        goal: "Laufender Anruf (GW0 ohne Wettlauf)",
        startedAt: beginn,
        answeredAt: beginn,
        maxDurationS: 1800,
      },
    ],
  });
  seed.usage = { [BOOTSTRAP_TENANT_ID]: { costCents: KOSTENDECKE_CENT - RESTBUDGET_CENT } };
  return seed;
}

test("GW0-KOSTENDECKE ohne Wettlauf: die Geld-Wache beendet den Auftragsanruf auch dann, wenn sie vor dem Init-Webhook greift", async () => {
  const srv = await startServer({
    env: {
      ELEVENLABS_AGENT_ID: "agent_gw0",
      ELEVENLABS_API_KEY: "el-gw0-schluessel",
      ELEVENLABS_RESULT_POLL_MS: "60000",
      ...vorspannMandantenUmgebung([BOOTSTRAP_TENANT_ID]),
      DEFAULT_TENANT_BUDGET_CENTS: String(KOSTENDECKE_CENT),
      VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENT,
      VOICE_TARIFF_DEFAULT_CENTS: TARIF_CENT,
      BUDGET_WATCHDOG_INTERVAL_MS: "200",
      FRISTEN_TAKT_MS: "40",
    },
    seed: seedMitLaufendemAnruf(),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const platziert = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: AUFTRAG }),
    });
    assert.equal(platziert.status, HTTP_OK);
    const { id } = srv.readStore().calls.find((call) => call.goal === AUFTRAG);
    const ereignis = { data: { id: "evt-gw0-ohne-wettlauf", event_type: "call.answered", payload: { call_control_id: calleeVon(id) } } };
    const angenommen = await abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ereignis),
    });
    assert.equal(angenommen.status, HTTP_OK);
    const store = await waitForStoreState(srv, (s) => s.calls.find((call) => call.id === id)?.status !== "active", ENDE_FRIST_MS);
    const anruf = store.calls.find((call) => call.id === id);
    assert.equal(anruf.failureReason, "budget-exhausted");
    await waitUntil(
      () => srv.vorspannAttrappe.anfragen.some((a) => a.methode === "POST" && a.pfad === `/v2/calls/${elVon(id)}/actions/hangup`),
      { timeoutMs: HANGUP_FRIST_MS },
    );
  } finally {
    await srv.stop();
  }
});
