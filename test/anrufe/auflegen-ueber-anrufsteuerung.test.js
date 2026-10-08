import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, seedState, seedCall, waitForStoreState, waitUntil } from "../helpers.js";
import { starteAufzeichnendeAttrappe } from "../helpers/aufzeichnende-attrappe.js";

const HTTP_OK = 200;
const WARTEZEIT_MS = 4000;
const LANG_VERGANGEN = "2020-01-01T00:00:00.000Z";
const KURZE_HOECHSTDAUER_S = 60;
const LANGE_HOECHSTDAUER_S = 180;
const TEXML_PFAD = "/v2/texml/";

const anrufIm = (stand, id) => stand.calls.find((anruf) => anruf.id === id);

const hangupPfad = (callControlId) => `/v2/calls/${callControlId}/actions/hangup`;

function legtNurUeberAnrufsteuerungAuf(anfragen, callControlId) {
  assert.deepEqual(
    anfragen.filter(({ pfad }) => pfad.startsWith("/v2/calls/")).map(({ pfad }) => pfad),
    [hangupPfad(callControlId)],
  );
  assert.ok(
    !anfragen.some(({ pfad }) => pfad.startsWith(TEXML_PFAD)),
    "ein Call-Control-Anruf wird nie ueber die TeXML-Schnittstelle beendet",
  );
}

async function mitTelnyxAttrappe(anrufe, ablauf) {
  const attrappe = await starteAufzeichnendeAttrappe(() => ({
    status: HTTP_OK,
    koerper: { data: { result: "ok" } },
  }));
  const srv = await startServer({
    env: {
      TELNYX_API_KEY: "KEYtest-secret",
      TELNYX_CONNECTION_ID: "conn_test",
      TELNYX_ACCOUNT_SID: "acct_test",
      TELNYX_API_BASE: attrappe.url,
    },
    seed: seedState({ calls: anrufe }),
  });
  try {
    await ablauf(srv, attrappe.anfragen);
  } finally {
    await srv.stop();
    await attrappe.schliesse();
  }
}

const aktiverCallControlAnruf = ({ id, callControlId, answeredAt, maxDurationS }) =>
  seedCall({
    id,
    status: "active",
    provider: "telnyx",
    twilioSid: null,
    callControlId,
    answeredAt,
    startedAt: answeredAt,
    maxDurationS,
  });

test("T6/Wiring: Boot-Re-Arm kappt einen ueberfaelligen Call-Control-Anruf und legt genau einmal ueber die Anrufsteuerung auf", async () => {
  const anruf = aktiverCallControlAnruf({
    id: "zombie_cc",
    callControlId: "cc_zombie",
    answeredAt: LANG_VERGANGEN,
    maxDurationS: KURZE_HOECHSTDAUER_S,
  });
  await mitTelnyxAttrappe([anruf], async (srv, anfragen) => {
    await waitUntil(() => anfragen.some(({ pfad }) => pfad === hangupPfad("cc_zombie")), {
      timeoutMs: WARTEZEIT_MS,
    });
    const stand = await waitForStoreState(
      srv,
      (st) => anrufIm(st, "zombie_cc")?.status === "failed",
    );
    assert.equal(anrufIm(stand, "zombie_cc").status, "failed");
    legtNurUeberAnrufsteuerungAuf(anfragen, "cc_zombie");
  });
});

test("T7: cancel_call legt einen Call-Control-Anruf genau einmal ueber die Anrufsteuerung auf", async () => {
  const anruf = aktiverCallControlAnruf({
    id: "live_cc",
    callControlId: "cc_live",
    answeredAt: new Date().toISOString(),
    maxDurationS: LANGE_HOECHSTDAUER_S,
  });
  await mitTelnyxAttrappe([anruf], async (srv, anfragen) => {
    const antwort = await fetch(`${srv.localUrl}/api/calls/live_cc/cancel`, { method: "POST" });
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(await antwort.json(), { status: "cancelled" });
    legtNurUeberAnrufsteuerungAuf(anfragen, "cc_live");
    assert.equal(anrufIm(srv.readStore(), "live_cc").status, "cancelled");
  });
});
