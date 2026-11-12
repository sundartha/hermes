import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitUntil, waitForLog, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";

const HTTP_OK = 200;
const WARTEZEIT_MS = 5000;
const EIGENE_NUMMER = "+4915199998888";
const ZIEL = "+4915112345678";
const ANGENOMMEN_UM = "2026-01-01T00:00:00.000Z";
const BEENDET_UM = "2026-01-01T00:05:00.000Z";
const SMS_GRENZE = 1500;
const LANGER_TEXT_LAENGE = 2000;

const geoeffnet = [];
after(async () => {
  await Promise.all(geoeffnet.map((schliessen) => schliessen()));
});

async function starteSmsEmpfaenger() {
  const telnyx = await starteAnbieterServer(({ req, body, res, vermerke }) => {
    vermerke({ pfad: req.url, koerper: body ? JSON.parse(body) : null });
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end("{}");
  });
  geoeffnet.push(() => telnyx.close());
  return telnyx;
}

const zustand = (calls, actionItems = []) =>
  seedState({
    actionItems,
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas", privateNumber: EIGENE_NUMMER }],
    numbers: [
      {
        id: "num_ende",
        e164: DOMESTIC_TEST_NUMBER.e164,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
    calls,
  });

const beendeterAnruf = (id, zusatz = {}) =>
  seedCall({
    id,
    from: DOMESTIC_TEST_NUMBER.e164,
    to: ZIEL,
    status: "completed",
    answeredAt: ANGENOMMEN_UM,
    endedAt: BEENDET_UM,
    transcript: [{ role: "caller", text: "Guten Tag", at: ANGENOMMEN_UM }],
    ...zusatz,
  });

const meldeStatus = (srv, callId, status) =>
  abrufMitFrist(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams({ CallStatus: status }),
  });

const hinweiseVon = (srv) => srv.readStore().notifications;
const anrufVon = (srv, id) => srv.readStore().calls.find((c) => c.id === id);

async function mitAnruf({ calls, actionItems = [], env = {} }, pruefe) {
  const telnyx = await starteSmsEmpfaenger();
  const srv = await startServer({
    seed: zustand(calls, actionItems),
    env: { SEND_SMS_SUMMARY: "true", TELNYX_API_BASE: telnyx.url, TELNYX_API_KEY: "test", ...env },
  });
  try {
    await pruefe(srv, telnyx);
  } finally {
    await srv.stop();
  }
}

test("3395-R1-1: Ende eines gefuehrten Anrufs meldet Zusammenfassung mit Aktionspunkten als Hinweis und SMS, bucht einmal", async () => {
  const punkte = ["Erster Punkt", "Zweiter Punkt"].map((text, i) => ({
    id: `ai_${i}`,
    callId: "ende_ok",
    text,
    done: false,
    createdAt: ANGENOMMEN_UM,
  }));
  await mitAnruf({ calls: [beendeterAnruf("ende_ok", { summary: "Termin steht." })], actionItems: punkte }, async (srv, telnyx) => {
    assert.equal((await meldeStatus(srv, "ende_ok", "completed")).status, HTTP_OK);
    await waitUntil(() => telnyx.anfragen.length === 1, { timeoutMs: WARTEZEIT_MS });
    assert.equal(telnyx.anfragen[0].pfad, "/v2/messages");
    assert.deepEqual(telnyx.anfragen[0].koerper, {
      from: DOMESTIC_TEST_NUMBER.e164,
      to: EIGENE_NUMMER,
      text: `[Hermes] Anruf bei ${ZIEL}\n\nTermin steht.\n\nAction Items:\n1. Zweiter Punkt\n2. Erster Punkt`,
    });
    await waitUntil(() => anrufVon(srv, "ende_ok").summarySmsSentAt, { timeoutMs: WARTEZEIT_MS });
    const hinweis = hinweiseVon(srv).find((n) => n.title === "Neue Call Summary");
    assert.equal(hinweis.body, `Anruf bei ${ZIEL}: Termin steht.`);
    assert.equal(hinweis.callId, "ende_ok");
    assert.ok(anrufVon(srv, "ende_ok").billedAt);
    await meldeStatus(srv, "ende_ok", "completed");
    assert.equal(telnyx.anfragen.length, 1);
    assert.equal(hinweiseVon(srv).filter((n) => n.title === "Neue Call Summary").length, 1);
  });
});

test("3395-R1-2: die Zusammenfassungs-SMS wird auf genau 1500 Zeichen gekappt, der Hinweis bleibt vollstaendig", async () => {
  const lang = "x".repeat(LANGER_TEXT_LAENGE);
  await mitAnruf({ calls: [beendeterAnruf("ende_lang", { summary: lang })] }, async (srv, telnyx) => {
    await meldeStatus(srv, "ende_lang", "completed");
    await waitUntil(() => telnyx.anfragen.length === 1, { timeoutMs: WARTEZEIT_MS });
    const { koerper } = telnyx.anfragen[0];
    const { text } = koerper;
    assert.equal(text.length, SMS_GRENZE);
    assert.ok(text.startsWith(`[Hermes] Anruf bei ${ZIEL}\n\nxxx`));
    await waitUntil(() => hinweiseVon(srv).length > 0, { timeoutMs: WARTEZEIT_MS });
    assert.equal(hinweiseVon(srv)[0].body, `Anruf bei ${ZIEL}: ${lang}`);
  });
});

test("3395-R1-3: eingehender Anruf ohne Gespraech meldet die Gegenseite, nicht das eigene Ziel, mit Grund", async () => {
  const eingehend = seedCall({
    id: "ende_ein",
    direction: "inbound",
    from: ZIEL,
    to: DOMESTIC_TEST_NUMBER.e164,
  });
  await mitAnruf({ calls: [eingehend] }, async (srv, telnyx) => {
    await meldeStatus(srv, "ende_ein", "no-answer");
    await waitUntil(() => hinweiseVon(srv).length > 0, { timeoutMs: WARTEZEIT_MS });
    const [hinweis] = hinweiseVon(srv);
    assert.equal(hinweis.title, "Anruf nicht zustande gekommen");
    assert.equal(hinweis.body, `${ZIEL} (Status: failed, Grund: niemand hat abgenommen)`);
    assert.equal(hinweis.callId, "ende_ein");
    assert.equal(telnyx.anfragen.length, 0);
  });
});

test("3395-R1-4: ausgehender Anruf ohne Abheben meldet das angerufene Ziel; gefuehrter Anruf ohne Mitschnitt gilt als nicht zustande gekommen", async () => {
  const ohneText = beendeterAnruf("ende_still", { transcript: [], summary: "Nichts." });
  await mitAnruf({ calls: [seedCall({ id: "ende_busy", from: DOMESTIC_TEST_NUMBER.e164, to: ZIEL }), ohneText] }, async (srv, telnyx) => {
    await meldeStatus(srv, "ende_busy", "busy");
    await meldeStatus(srv, "ende_still", "completed");
    await waitUntil(() => hinweiseVon(srv).length === 2, { timeoutMs: WARTEZEIT_MS });
    const bodies = hinweiseVon(srv).map((n) => n.body).sort();
    assert.deepEqual(bodies, [
      `${ZIEL} (Status: completed)`,
      `${ZIEL} (Status: failed, Grund: die Leitung war besetzt)`,
    ]);
    assert.ok(hinweiseVon(srv).every((n) => n.title === "Anruf nicht zustande gekommen"));
    assert.equal(telnyx.anfragen.length, 0);
  });
});

test("3395-R1-5: Neustart terminalisiert einen abgelaufenen Anruf mit Cap-Grund und zaehlt Zombie und Rest getrennt", async () => {
  const zombie = seedCall({
    id: "boot_zombie",
    answeredAt: "2020-01-01T00:00:00.000Z",
    startedAt: "2020-01-01T00:00:00.000Z",
    maxDurationS: 60,
  });
  const lebend = seedCall({ id: "boot_lebend", answeredAt: new Date().toISOString(), maxDurationS: 180 });
  const srv = await startServer({ seed: zustand([zombie, lebend], []) });
  try {
    await waitForLog(srv, /\[rearm\] aktive Calls beim Boot: 1 re-armed, 1 terminalisiert \(Zombie\)/);
    await waitUntil(() => anrufVon(srv, "boot_zombie").failureReason, { timeoutMs: WARTEZEIT_MS });
    const [z, l] = ["boot_zombie", "boot_lebend"].map((id) => anrufVon(srv, id));
    assert.equal(z.failureReason, "max-duration-cap");
    assert.equal(z.status, "failed");
    assert.equal(l.status, "active");
  } finally {
    await srv.stop();
  }
});
