import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const MS_PER_SECOND = 1000;
const HTTP_OK = 200;
const CALL_ID = "call_4755";
const BEGLEITER_ID = "call_4755_laeuft";
const CONV_ID = "conv_4755";
const FRIST_S = 75;
const MEHRERE_ABFRAGEN = 3;
const POLL_MS = "100";
const EL_SIP = "el_convai_sip";
const TELNYX = "telnyx_budget";

const laufend = (zusatz = {}) => ({
  conversation_id: CONV_ID,
  status: "in-progress",
  transcript: [],
  metadata: { call_duration_secs: 0 },
  ...zusatz,
});

async function starteAnbieterAttrappe(gespraech) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    anfragen.push(req.method);
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(req.method === "GET" ? gespraech : {}));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    anfragen,
    close: () => new Promise((fertig) => server.close(fertig)),
  };
}

function seed({ alterS, costProfile }) {
  const start = new Date(Date.now() - alterS * MS_PER_SECOND).toISOString();
  return seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        provider: "telnyx",
        costProfile,
        startedAt: start,
        answeredAt: start,
        maxDurationS: 3600,
        elevenlabsConversationId: CONV_ID,
      }),
    ],
  });
}

async function mitAnruf({ alterS, gespraech, costProfile = EL_SIP }, pruefe) {
  const attrappe = await starteAnbieterAttrappe(gespraech);
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: attrappe.url, ELEVENLABS_API_KEY: "test-key", ELEVENLABS_RESULT_POLL_MS: POLL_MS },
    seed: seed({ alterS, costProfile }),
  });
  try {
    await pruefe(srv, attrappe);
  } finally {
    await srv.stop();
    await attrappe.close();
  }
}

const leseAnruf = async (srv) => (await abrufMitFrist(`${srv.localUrl}/api/calls/${CALL_ID}`)).json();
const imStore = (srv) => srv.readStore().calls.find((eintrag) => eintrag.id === CALL_ID);

const abfragenAbwarten = (srv, attrappe) =>
  waitForStoreState(srv, () => attrappe.anfragen.filter((art) => art === "GET").length >= MEHRERE_ABFRAGEN);

async function beobachteWeiterlaufend(srv, attrappe) {
  await abfragenAbwarten(srv, attrappe);
  const call = imStore(srv);
  assert.equal(call.status, "active");
  assert.equal(attrappe.anfragen.includes("DELETE"), false);
}

test("4755 K1: nach 75 s ohne Annahme ist der Anruf failed/no-answer, ohne Buchungsanker, beim Anbieter beendet", async () => {
  await mitAnruf({ alterS: FRIST_S + 1, gespraech: laufend() }, async (srv, attrappe) => {
    await waitForStoreState(srv, () => imStore(srv).status !== "active" && attrappe.anfragen.includes("DELETE"));

    const call = imStore(srv);
    assert.equal(call.status, "failed");
    assert.equal(call.failureReason, "no-answer");
    assert.equal(call.answeredAt, null);
    assert.equal(call.answeredUnclearReason, "call_duration_secs_zero_not_answered");
    const sicht = await leseAnruf(srv);
    assert.equal(sicht.status, "failed");
    assert.equal(sicht.failureReason, "no-answer");
  });
});

test("4755 K1: ein frischer Anruf bleibt innerhalb der Frist aktiv", async () => {
  await mitAnruf({ alterS: 0, gespraech: laufend() }, beobachteWeiterlaufend);
});

test("4755 K5: gesprochene Zeilen belegen die Annahme, die Frist beendet nicht", async () => {
  const gespraech = laufend({ transcript: [{ role: "agent", message: "Guten Tag" }] });
  await mitAnruf({ alterS: FRIST_S * 2, gespraech }, beobachteWeiterlaufend);
});

test("4755 K5: eine Anbieter-Dauer belegt die Annahme, die Frist beendet nicht", async () => {
  const gespraech = laufend({ metadata: { call_duration_secs: 12 } });
  await mitAnruf({ alterS: FRIST_S * 2, gespraech }, beobachteWeiterlaufend);
});

test("4755: Zeilen ohne Text zaehlen nicht als Annahme", async () => {
  const gespraech = laufend({ transcript: [{ role: "agent", message: "" }, null] });
  await mitAnruf({ alterS: FRIST_S * 2, gespraech }, async (srv) => {
    await waitForStoreState(srv, () => imStore(srv).status !== "active");

    assert.equal(imStore(srv).failureReason, "no-answer");
  });
});

test("4755: ein Anruf ueber Telnyx wird von der Frist nicht beendet", async () => {
  await mitAnruf({ alterS: FRIST_S * 2, gespraech: laufend(), costProfile: TELNYX }, beobachteWeiterlaufend);
});

test("4755 K2: ein schon als besetzt beendeter Anruf wird von der Frist nicht erneut beendet", async () => {
  const attrappe = await starteAnbieterAttrappe(laufend());
  const start = new Date(Date.now() - FRIST_S * 2 * MS_PER_SECOND).toISOString();
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: attrappe.url, ELEVENLABS_API_KEY: "test-key", ELEVENLABS_RESULT_POLL_MS: POLL_MS },
    seed: seedState({
      calls: [
        seedCall({
          id: CALL_ID,
          provider: "telnyx",
          costProfile: EL_SIP,
          status: "failed",
          failureReason: "busy",
          startedAt: start,
          endedAt: start,
          elevenlabsConversationId: CONV_ID,
        }),
        seedCall({
          id: BEGLEITER_ID,
          provider: "telnyx",
          costProfile: EL_SIP,
          startedAt: new Date().toISOString(),
          elevenlabsConversationId: CONV_ID,
        }),
      ],
    }),
  });
  try {
    await abfragenAbwarten(srv, attrappe);

    assert.equal(imStore(srv).failureReason, "busy");
    assert.equal(attrappe.anfragen.includes("DELETE"), false);
  } finally {
    await srv.stop();
    await attrappe.close();
  }
});
