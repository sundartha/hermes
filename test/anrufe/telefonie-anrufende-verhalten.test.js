import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, warteAufEreignis, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";

const FRISTEN_TAKT_MS = 40;
const HTTP_OK = 200;
const WARTEZEIT_MS = 5000;
const EIGENE_NUMMER = "+4915199998888";
const ZIEL = "+4915112345678";
const ANGENOMMEN_UM = "2026-01-01T00:00:00.000Z";
const BEENDET_UM = "2026-01-01T00:05:00.000Z";

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

test("3395-R1-1: Ende eines gefuehrten Anrufs meldet Zusammenfassung als Hinweis, keine SMS, bucht einmal", async () => {
  await mitAnruf({ calls: [beendeterAnruf("ende_ok", { summary: "Termin steht." })] }, async (srv, telnyx) => {
    assert.equal((await meldeStatus(srv, "ende_ok", "completed")).status, HTTP_OK);
    await warteAufEreignis([srv.ereignisse], () => hinweiseVon(srv).length > 0, { timeoutMs: WARTEZEIT_MS });
    const hinweis = hinweiseVon(srv).find((n) => n.title === "Neue Call Summary");
    assert.equal(hinweis.body, `Anruf bei ${ZIEL}: Termin steht.`);
    assert.equal(hinweis.callId, "ende_ok");
    assert.ok(anrufVon(srv, "ende_ok").billedAt);
    await meldeStatus(srv, "ende_ok", "completed");
    assert.equal(telnyx.anfragen.length, 0);
    assert.equal(hinweiseVon(srv).filter((n) => n.title === "Neue Call Summary").length, 1);
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
    await warteAufEreignis([srv.ereignisse], () => hinweiseVon(srv).length > 0, { timeoutMs: WARTEZEIT_MS });
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
    await warteAufEreignis([srv.ereignisse], () => hinweiseVon(srv).length === 2, { timeoutMs: WARTEZEIT_MS });
    const bodies = hinweiseVon(srv).map((n) => n.body).sort();
    assert.deepEqual(bodies, [
      `${ZIEL} (Status: completed)`,
      `${ZIEL} (Status: failed, Grund: die Leitung war besetzt)`,
    ]);
    assert.ok(hinweiseVon(srv).every((n) => n.title === "Anruf nicht zustande gekommen"));
    assert.equal(telnyx.anfragen.length, 0);
  });
});

test("3395-R1-5: der Fristen-Lauf terminalisiert einen abgelaufenen Anruf mit Cap-Grund, ein lebender Anruf bleibt aktiv", async () => {
  const zombie = seedCall({
    id: "boot_zombie",
    answeredAt: "2020-01-01T00:00:00.000Z",
    startedAt: "2020-01-01T00:00:00.000Z",
    maxDurationS: 60,
  });
  const lebend = seedCall({ id: "boot_lebend", answeredAt: new Date().toISOString(), maxDurationS: 180 });
  const srv = await startServer({ env: { FRISTEN_TAKT_MS: String(FRISTEN_TAKT_MS) }, seed: zustand([zombie, lebend], []) });
  try {
    await warteAufEreignis([srv.ereignisse], () => anrufVon(srv, "boot_zombie").status === "failed", { timeoutMs: WARTEZEIT_MS });
    const [z, l] = ["boot_zombie", "boot_lebend"].map((id) => anrufVon(srv, id));
    assert.equal(z.failureReason, "max-duration-cap");
    assert.equal(z.status, "failed");
    assert.equal(l.status, "active");
  } finally {
    await srv.stop();
  }
});
