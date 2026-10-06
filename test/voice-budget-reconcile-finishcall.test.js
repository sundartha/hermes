import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog, DOMESTIC_TEST_NUMBER } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const BILLED_MINUTES = 5;
const DOMESTIC_TARIFF_CENTS = 20;
const DEFAULT_TARIFF_CENTS = 300;
const INBOUND_TARIFF_CENTS = 5;
const DOMESTIC_TO = "+4915112345678";
const INTL_TO = "+12025550123";

const postStatus = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

async function completeCall(srv, callId) {
  const res = await postStatus(srv, callId, { CallStatus: "completed" });
  assert.equal(res.status, 200);
  await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId}"`));
}

const ownerCostCents = (srv) => srv.readStore().usage[BOOTSTRAP_TENANT_ID].costCents;

const BUCHUNGS_FRIST_MS = 3000;
const POLL_TAKT_MS = 20;
async function ownerCostCentsNachBuchung(srv, standDavor) {
  const frist = Date.now() + BUCHUNGS_FRIST_MS;
  for (;;) {
    const cents = ownerCostCents(srv);
    if (cents !== standDavor || Date.now() > frist) return cents;
    await new Promise((aufloesen) => setTimeout(aufloesen, POLL_TAKT_MS));
  }
}

test("Reconcile-Verdrahtung: outbound bucht tarif-x-minuten, inbound bucht den kalibrierten Inbound-Satz", async () => {
  const srv = await startServer({
    env: {
      VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS),
      VOICE_TARIFF_DEFAULT_CENTS: String(DEFAULT_TARIFF_CENTS),
      VOICE_TARIFF_INBOUND_CENTS: String(INBOUND_TARIFF_CENTS),
    },
    seed: seedState({
      calls: [
        seedCall({
          id: "rc_inbound",
          direction: "inbound",
          from: DOMESTIC_TO,
          status: "completed",
          answeredAt: ANSWERED_AT,
          endedAt: ENDED_AT,
        }),
        seedCall({
          id: "rc_out_dom",
          direction: "outbound",
          to: DOMESTIC_TO,
          from: DOMESTIC_TEST_NUMBER.e164,
          status: "completed",
          answeredAt: ANSWERED_AT,
          endedAt: ENDED_AT,
        }),
        seedCall({
          id: "rc_out_intl",
          direction: "outbound",
          to: INTL_TO,
          status: "completed",
          answeredAt: ANSWERED_AT,
          endedAt: ENDED_AT,
        }),
      ],
    }),
  });
  try {
    await completeCall(srv, "rc_inbound");
    const afterInbound = BILLED_MINUTES * INBOUND_TARIFF_CENTS;
    assert.equal(await ownerCostCentsNachBuchung(srv, 0), afterInbound, "Inbound bucht Minuten x kalibrierten Inbound-Satz");

    await completeCall(srv, "rc_out_dom");
    const afterDomestic = afterInbound + BILLED_MINUTES * DOMESTIC_TARIFF_CENTS;
    assert.equal(await ownerCostCentsNachBuchung(srv, afterInbound), afterDomestic, "Outbound Inland: Minuten x Inlandstarif additiv gebucht");

    await completeCall(srv, "rc_out_intl");
    const afterIntl = afterDomestic + BILLED_MINUTES * DEFAULT_TARIFF_CENTS;
    assert.equal(await ownerCostCentsNachBuchung(srv, afterDomestic), afterIntl, "Outbound International: Default-Tarif additiv gebucht");
  } finally {
    await srv.stop();
  }
});
