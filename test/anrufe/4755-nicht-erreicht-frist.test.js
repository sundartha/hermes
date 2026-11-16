import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { NICHT_ERREICHT_FRIST_MS, nichtErreichtNachFrist } from "../../src/elevenlabs/nicht-erreicht-frist.ts";

const MS_PER_SECOND = 1000;
const HTTP_OK = 200;
const CALL_ID = "call_4755";
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

const beendet = (srv) => waitForStoreState(srv, () => imStore(srv).status !== "active");
const beendetMitGrund = (srv) => waitForStoreState(srv, () => imStore(srv).status === "failed" && Boolean(imStore(srv).failureReason));

test("4755 K2: meldet der Anbieter das Gespraech mit Dauer 0 als beendet, ist der Anruf sofort failed/no-answer", async () => {
  const gespraech = laufend({ status: "done" });
  await mitAnruf({ alterS: 5, gespraech }, async (srv) => {
    await beendetMitGrund(srv);

    const call = imStore(srv);
    assert.equal(call.status, "failed");
    assert.equal(call.failureReason, "no-answer");
    assert.equal(call.answeredAt, null);
    const sicht = await leseAnruf(srv);
    assert.equal(sicht.status, "failed");
    assert.equal(sicht.failureReason, "no-answer");
  });
});

test("4755 K2: besetzt meldet der Anbieter als Fehler 486, der Anruf ist sofort failed mit passendem Grund", async () => {
  const gespraech = laufend({
    status: "done",
    metadata: { call_duration_secs: 0, error: { reason: "SIP Status: 486 Busy Here" } },
  });
  await mitAnruf({ alterS: 5, gespraech }, async (srv) => {
    await beendetMitGrund(srv);

    const call = imStore(srv);
    assert.equal(call.status, "failed");
    assert.equal(call.failureReason, "busy");
  });
});

test("4755 K2: besetzt mit Carrier-Code D21 endet ebenfalls mit busy", async () => {
  const gespraech = laufend({
    status: "done",
    metadata: { call_duration_secs: 0, error: { reason: "SIP Status: 486 Busy Here D21" } },
  });
  await mitAnruf({ alterS: 5, gespraech }, async (srv) => {
    await beendetMitGrund(srv);

    const call = imStore(srv);
    assert.equal(call.status, "failed");
    assert.equal(call.failureReason, "busy");
  });
});

test("4755 K2: ein beendetes Gespraech mit gesprochenen Zeilen bleibt completed ohne Grund", async () => {
  const gespraech = laufend({
    status: "done",
    transcript: [{ role: "agent", message: "Guten Tag" }],
    metadata: { call_duration_secs: 0 },
  });
  await mitAnruf({ alterS: 5, gespraech }, async (srv) => {
    await beendet(srv);

    assert.equal(imStore(srv).status, "completed");
    assert.equal(imStore(srv).failureReason ?? null, null);
  });
});

test("4755 K2: ein beendetes Gespraech mit Anbieter-Dauer bleibt completed ohne Grund", async () => {
  const gespraech = laufend({ status: "done", metadata: { call_duration_secs: 12 } });
  await mitAnruf({ alterS: 30, gespraech }, async (srv) => {
    await beendet(srv);

    assert.equal(imStore(srv).status, "completed");
    assert.equal(imStore(srv).failureReason ?? null, null);
  });
});

test("4755: ein Anbieter-Ergebnis ohne metadata beendet den Anruf ohne Grund als completed", async () => {
  const gespraech = laufend({ status: "done", metadata: undefined });
  await mitAnruf({ alterS: 5, gespraech }, async (srv) => {
    await beendet(srv);

    assert.equal(imStore(srv).status, "completed");
    assert.equal(imStore(srv).failureReason ?? null, null);
  });
});

test("4755: ein laufendes Gespraech ohne metadata und ohne Transkript ist nach 75 s failed/no-answer", async () => {
  const gespraech = laufend({ metadata: undefined, transcript: undefined });
  await mitAnruf({ alterS: FRIST_S + 1, gespraech }, async (srv) => {
    await beendetMitGrund(srv);

    assert.equal(imStore(srv).failureReason, "no-answer");
  });
});

test("4755: eine Anbieter-Dauer, die keine Zahl ist, zaehlt nicht als Annahme", async () => {
  const gespraech = laufend({ metadata: { call_duration_secs: "12" } });
  await mitAnruf({ alterS: FRIST_S + 1, gespraech }, async (srv) => {
    await beendetMitGrund(srv);

    assert.equal(imStore(srv).failureReason, "no-answer");
  });
});

const GRENZ_START_MS = Date.parse("2026-01-01T00:00:00.000Z");
const grenzFall = (versatzMs) =>
  nichtErreichtNachFrist({
    call: { costProfile: EL_SIP, startedAt: new Date(GRENZ_START_MS).toISOString() },
    conversation: { transcript: [], metadata: { call_duration_secs: 0 } },
    nowMs: GRENZ_START_MS + NICHT_ERREICHT_FRIST_MS + versatzMs,
  });

test("4755: die Frist gilt genau bei 75 s, eine Millisekunde davor noch nicht", () => {
  assert.equal(grenzFall(-1), false);
  assert.equal(grenzFall(0), true);
  assert.equal(grenzFall(1), true);
});
