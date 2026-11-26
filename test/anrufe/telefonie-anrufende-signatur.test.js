import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  warteAufEreignis,
  makeTelnyxSigner,
  nowSeconds,
  DOMESTIC_TEST_NUMBER,
} from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const FRIST = { timeout: 60_000 };
const WARTEZEIT_MS = 30_000;
const EIGENE_NUMMER = "+4915199998888";
const ZIEL = "+4915112345678";
const ANGENOMMEN_UM = "2026-01-01T00:00:00.000Z";
const BEENDET_UM = "2026-01-01T00:05:00.000Z";

const signer = makeTelnyxSigner();
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
        id: "num_signatur",
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

function meldeStatus(srv, callId, status) {
  return meldeMit(srv, callId, { status, signatur: "echt" });
}

function meldeMit(srv, callId, { status, signatur }) {
  const body = new URLSearchParams({ CallStatus: status }).toString();
  const zeit = String(nowSeconds());
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (signatur !== "keine") {
    headers["telnyx-timestamp"] = zeit;
    headers["telnyx-signature-ed25519"] = signatur === "echt" ? signer.sign(zeit, body) : signer.sign(zeit, `${body}&x=1`);
  }
  return abrufMitFrist(`${srv.localUrl}/voice/status?callId=${callId}`, { method: "POST", headers, body });
}

const hinweiseVon = (srv) => srv.readStore().notifications;
const anrufVon = (srv, id) => srv.readStore().calls.find((c) => c.id === id);

async function mitAnruf({ calls, actionItems = [] }, pruefe) {
  const telnyx = await starteSmsEmpfaenger();
  const srv = await startServer({
    seed: zustand(calls, actionItems),
    env: {
      SEND_SMS_SUMMARY: "true",
      TELNYX_API_BASE: telnyx.url,
      TELNYX_API_KEY: "test",
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    },
  });
  try {
    await pruefe(srv, telnyx);
  } finally {
    await srv.stop();
  }
}

test("3974-1: signierte Endemeldung eines gefuehrten Anrufs liefert 200, Hinweis, keine SMS und eine Buchung", FRIST, async () => {
  await mitAnruf({ calls: [beendeterAnruf("sig_ok", { summary: "Termin steht." })] }, async (srv, telnyx) => {
    assert.equal((await meldeStatus(srv, "sig_ok", "completed")).status, HTTP_OK);
    await warteAufEreignis([srv.ereignisse], () => hinweiseVon(srv).length > 0, { timeoutMs: WARTEZEIT_MS });
    const hinweis = hinweiseVon(srv).find((n) => n.title === "Neue Call Summary");
    assert.equal(hinweis.body, `Anruf bei ${ZIEL}: Termin steht.`);
    assert.equal(hinweis.callId, "sig_ok");
    assert.ok(anrufVon(srv, "sig_ok").billedAt);
    assert.equal((await meldeStatus(srv, "sig_ok", "completed")).status, HTTP_OK);
    assert.equal(telnyx.anfragen.length, 0);
    assert.equal(hinweiseVon(srv).filter((n) => n.title === "Neue Call Summary").length, 1);
  });
});

test("3974-2: Endemeldung ohne Signatur wird mit 403 abgelehnt, ohne Hinweis und ohne SMS", FRIST, async () => {
  await mitAnruf({ calls: [beendeterAnruf("sig_keine", { summary: "Termin steht." })] }, async (srv, telnyx) => {
    assert.equal((await meldeMit(srv, "sig_keine", { status: "completed", signatur: "keine" })).status, HTTP_FORBIDDEN);
    assert.equal(hinweiseVon(srv).length, 0);
    assert.equal(telnyx.anfragen.length, 0);
    assert.equal(anrufVon(srv, "sig_keine").summarySmsSentAt, undefined);
  });
});

test("3974-3: Endemeldung mit ungueltiger Signatur wird mit 403 abgelehnt, ohne Hinweis und ohne SMS", FRIST, async () => {
  await mitAnruf({ calls: [beendeterAnruf("sig_falsch", { summary: "Termin steht." })] }, async (srv, telnyx) => {
    assert.equal((await meldeMit(srv, "sig_falsch", { status: "completed", signatur: "falsch" })).status, HTTP_FORBIDDEN);
    assert.equal(hinweiseVon(srv).length, 0);
    assert.equal(telnyx.anfragen.length, 0);
    assert.equal(anrufVon(srv, "sig_falsch").summarySmsSentAt, undefined);
  });
});

test("3974-4: signierte Meldung eines eingehenden Anrufs ohne Gespraech nennt die Gegenseite mit Grund", FRIST, async () => {
  const eingehend = seedCall({ id: "sig_ein", direction: "inbound", from: ZIEL, to: DOMESTIC_TEST_NUMBER.e164 });
  await mitAnruf({ calls: [eingehend] }, async (srv, telnyx) => {
    assert.equal((await meldeStatus(srv, "sig_ein", "no-answer")).status, HTTP_OK);
    await warteAufEreignis([srv.ereignisse], () => hinweiseVon(srv).length > 0, { timeoutMs: WARTEZEIT_MS });
    const [hinweis] = hinweiseVon(srv);
    assert.equal(hinweis.title, "Anruf nicht zustande gekommen");
    assert.equal(hinweis.body, `${ZIEL} (Status: failed, Grund: niemand hat abgenommen)`);
    assert.equal(hinweis.callId, "sig_ein");
    assert.equal(telnyx.anfragen.length, 0);
  });
});

test("3974-5: signierte Meldungen ausgehender Anrufe ohne Abheben oder ohne Mitschnitt nennen das Ziel", FRIST, async () => {
  const ohneText = beendeterAnruf("sig_still", { transcript: [], summary: "Nichts." });
  const besetzt = seedCall({ id: "sig_busy", from: DOMESTIC_TEST_NUMBER.e164, to: ZIEL });
  await mitAnruf({ calls: [besetzt, ohneText] }, async (srv, telnyx) => {
    assert.equal((await meldeStatus(srv, "sig_busy", "busy")).status, HTTP_OK);
    assert.equal((await meldeStatus(srv, "sig_still", "completed")).status, HTTP_OK);
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
